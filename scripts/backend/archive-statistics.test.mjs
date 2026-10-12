import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./harness.mjs";
import {
  addStatisticsBulkData,
  createStatisticsFixture,
  statisticsCookie,
  statisticsOrigins,
} from "./archive-statistics-fixture.mjs";

const { readArchiveStatistics, parseArchiveRequest } = await loadModule("src/services/archive-statistics.ts");
const all = { year: null, productionId: null, visibility: "all" };
const read = (db, filter = all, editionsPage = 1, membersPage = 1) =>
  readArchiveStatistics(db, { filter, editionsPage, membersPage });
const ids = (html, kind) =>
  [...html.matchAll(new RegExp(`data-archive-${kind}="(\\d+)"`, "g"))].map((match) => Number(match[1]));
const metric = (html, key) => Number(new RegExp(`data-archive-stat="${key}">(\\d+)<`).exec(html)?.[1]);

test(
  "real D1 and Worker: archive statistics, complete independent pagination and administrator boundary",
  { timeout: 120000 },
  async (t) => {
    const s = await createStatisticsFixture();
    try {
      await t.test("full aggregates deduplicate people and preaggregate credits/resources", async () => {
        const data = await read(s.db);
        assert.deepEqual(data.summary, {
          productions: 3,
          editions: 4,
          approved: 6,
          missing_script: 3,
          missing_photo: 1,
          people: 3,
          credits: 5,
          publicResources: 6,
        });
        const first = data.editions.find((row) => row.edition_id === 1);
        assert.equal(first.credit_count, 3);
        assert.equal(first.member_count, 2);
        assert.equal(first.approved_count, 3);
        assert.equal(first.photo_count, 1);
        assert.equal(first.script_count, 1);
        const actor = data.members.find((row) => row.member_id === 1);
        assert.deepEqual(
          [actor.productions, actor.editions, actor.credits, actor.cast_count, actor.crew_count],
          [1, 2, 3, 2, 1],
        );
        assert.deepEqual(
          data.years.map((row) => [row.year, row.people, row.credits]),
          [
            [2025, 2, 2],
            [2024, 2, 3],
            [null, 0, 0],
          ],
        );
        assert.deepEqual(
          [
            data.reviews.total,
            data.reviews.pending,
            data.reviews.approved,
            data.reviews.rejected,
            data.reviews.unassigned,
            data.reviews.manual_samples,
          ],
          [9, 1, 7, 1, 1, 2],
        );
        assert.ok(Math.abs(data.reviews.average_review_hours - 5) < 0.0001);
        const response = await s.request("/admin/archive-statistics");
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.equal(metric(html, "people"), 3);
        assert.equal(metric(html, "review-total"), 9);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-blackbox-navigation"), null);
        assert.match(html, /href="\/admin\/archive-statistics" aria-current="page"/);
      });

      await t.test("public projection omits hidden, unapproved and sensitive fields", async () => {
        const rows = (await s.db.prepare("SELECT * FROM v_public_resource_info ORDER BY resource_id").all()).results;
        assert.deepEqual(
          rows.map((row) => row.resource_id),
          [1, 2, 3, 4, 8, 9],
        );
        for (const row of rows)
          for (const field of [
            "filename",
            "password_hash",
            "email",
            "reviewed_by",
            "reviewed_at",
            "uploader_id",
            "admin_note",
          ])
            assert.equal(field in row, false, field);
        const html = await (await s.request("/admin/archive-statistics")).text();
        assert.doesNotMatch(
          html,
          /synthetic-private-object|synthetic-password-marker|@example\.invalid|private-review-note-marker/,
        );
      });

      await t.test("filters distinguish missing edition years from unassigned resources", async () => {
        const revival = await read(s.db, { year: 2025, productionId: 1, visibility: "public" });
        assert.deepEqual(
          [
            revival.summary.editions,
            revival.summary.people,
            revival.summary.publicResources,
            revival.reviews.total,
            revival.reviews.unassigned,
          ],
          [1, 1, 1, 3, 0],
        );
        const hidden = await read(s.db, { ...all, visibility: "hidden" });
        assert.deepEqual(
          [
            hidden.summary.editions,
            hidden.summary.people,
            hidden.summary.publicResources,
            hidden.reviews.total,
            hidden.reviews.unassigned,
          ],
          [1, 1, 0, 1, 0],
        );
        const missing = await read(s.db, { ...all, year: "missing" });
        assert.deepEqual(
          [
            missing.summary.editions,
            missing.summary.publicResources,
            missing.reviews.total,
            missing.reviews.unassigned,
          ],
          [1, 1, 1, 0],
        );
        assert.equal(missing.reviews.average_review_hours, null);
        const published = await read(s.db, { ...all, visibility: "public" });
        assert.deepEqual(
          [published.summary.editions, published.reviews.total, published.reviews.unassigned],
          [3, 8, 1],
        );
        const empty = await read(s.db, { ...all, year: 1999 }, 999, 999);
        assert.deepEqual(empty.summary, {
          productions: 0,
          editions: 0,
          approved: 0,
          missing_script: 0,
          missing_photo: 0,
          people: 0,
          credits: 0,
          publicResources: 0,
        });
        assert.deepEqual(empty.years, []);
        assert.deepEqual(empty.editions, []);
        assert.deepEqual(empty.members, []);
        assert.equal(empty.editionsPagination.page, 1);
        assert.equal(empty.membersPagination.page, 1);
        const html = await (await s.request("/admin/archive-statistics?year=1999")).text();
        assert.match(html, /<option value="1999" selected>/);
        assert.match(html, /当前范围没有演出版本/);
      });

      await t.test("strict input validation rejects malformed filters, duplicate keys and page values", async () => {
        for (const query of [
          "year=2024x",
          "year=0",
          "year=-2024",
          "year=10000",
          "year=2e3",
          "year=2024&year=2025",
          "production_id=-1",
          "production_id=1.5",
          "production_id=9007199254740992",
          "production_id=1%20OR%201=1",
          "production_id=1&production_id=2",
          "visibility=private",
          "visibility=public&visibility=hidden",
          "editions_page=0",
          "members_page=-1",
          "editions_page=1.5",
          "members_page=",
          "members_page=10000000",
          "editions_page=1&editions_page=2",
        ]) {
          assert.equal(parseArchiveRequest(new URLSearchParams(query)), null, query);
          const response = await s.request("/admin/archive-statistics?" + query);
          assert.equal(response.status, 400, query);
          assert.equal(response.headers.get("cache-control"), "private, no-store");
        }
        assert.equal((await s.request("/admin/archive-statistics?production_id=99999")).status, 404);
        assert.equal(
          (await s.request("/admin/archive-statistics?editions_page=9999999&members_page=9999999")).status,
          200,
        );
        assert.deepEqual(
          parseArchiveRequest(
            new URLSearchParams("year=missing&production_id=1&visibility=hidden&editions_page=2&members_page=3"),
          ),
          { filter: { year: "missing", productionId: 1, visibility: "hidden" }, editionsPage: 2, membersPage: 3 },
        );
      });

      await t.test("only active administrators read statistics; redirect retains all filters", async () => {
        const path = "/admin/archive-statistics?year=missing&visibility=public&editions_page=2&members_page=3";
        for (const uid of [2, 5]) assert.equal((await s.request(path, uid)).status, 403);
        for (const uid of [null, 3]) {
          const response = await s.request(path, uid);
          assert.equal(response.status, 302);
          assert.equal(response.headers.get("location"), "/login?next=" + encodeURIComponent(path));
        }
        assert.equal((await s.request(path, 4)).headers.get("location"), "/profile");
        const expired = await s.request(path, 1, { headers: { Cookie: statisticsCookie(1, { exp: 1 }) } });
        assert.equal(expired.status, 302);
        const stale = await s.request(path, 1, { headers: { Cookie: statisticsCookie(1, { version: 1 }) } });
        assert.equal(stale.status, 302);
        const redirected = await s.request(path, null, { origin: statisticsOrigins.publicSite });
        assert.equal(redirected.status, 302);
        assert.equal(redirected.headers.get("location"), statisticsOrigins.admin + path);
        assert.equal(redirected.headers.get("cache-control"), "private, no-store");
      });

      await t.test("more than 60 editions and 50 members remain reachable with full summaries", async () => {
        await addStatisticsBulkData(s.db);
        const data = await read(s.db);
        assert.deepEqual(data.summary, {
          productions: 3,
          editions: 74,
          approved: 76,
          missing_script: 73,
          missing_photo: 1,
          people: 73,
          credits: 75,
          publicResources: 76,
        });
        const expectedEditions = (
          await s.db
            .prepare("SELECT edition_id FROM v_edition_archive_stats ORDER BY year DESC,production_id,edition_id")
            .all()
        ).results.map((row) => row.edition_id);
        const expectedMembers = (
          await s.db
            .prepare(
              "SELECT member_id FROM v_member_participation GROUP BY member_id ORDER BY COUNT(DISTINCT edition_id) DESC,COUNT(*) DESC,member_id",
            )
            .all()
        ).results.map((row) => row.member_id);
        const editionIds = [],
          memberIds = [];
        for (let page = 1; page <= 4; page++) {
          const html = await (
            await s.request(`/admin/archive-statistics?editions_page=${page}&members_page=${page}`)
          ).text();
          assert.equal(metric(html, "editions"), 74);
          assert.equal(metric(html, "people"), 73);
          assert.equal(metric(html, "review-total"), 79);
          editionIds.push(...ids(html, "edition"));
          memberIds.push(...ids(html, "member"));
        }
        assert.deepEqual(editionIds, expectedEditions);
        assert.deepEqual(memberIds, expectedMembers);
        assert.equal(new Set(editionIds).size, 74);
        assert.equal(new Set(memberIds).size, 73);
        assert.equal(
          data.years.reduce((sum, row) => sum + row.editions, 0),
          74,
        );
        assert.equal(
          data.years.reduce((sum, row) => sum + row.approved, 0),
          76,
        );
        assert.equal(data.years.find((row) => row.year === 2024).people, 72);
      });

      await t.test("each pager preserves filters and the other section's actual page", async () => {
        const query = "year=2024&production_id=1&visibility=public&editions_page=2&members_page=3";
        const html = await (await s.request("/admin/archive-statistics?" + query)).text();
        assert.match(html, /共 71 条 · 当前第 25–48 条/);
        assert.match(html, /共 72 条 · 当前第 49–72 条/);
        assert.equal(metric(html, "editions"), 71);
        assert.equal(metric(html, "people"), 72);
        const editionNav = /<nav class="pagination" aria-label="版本资料覆盖分页">([\s\S]*?)<\/nav>/.exec(html)[1];
        const memberNav = /<nav class="pagination" aria-label="成员参与分页">([\s\S]*?)<\/nav>/.exec(html)[1];
        assert.match(
          editionNav,
          /year=2024&amp;production_id=1&amp;visibility=public&amp;members_page=3&amp;detail=editions&amp;editions_page=3#archive-editions/,
        );
        assert.match(
          memberNav,
          /year=2024&amp;production_id=1&amp;visibility=public&amp;editions_page=2&amp;detail=members&amp;members_page=2#archive-members/,
        );
        const next = await read(s.db, { year: 2024, productionId: 1, visibility: "public" }, 3, 3);
        assert.equal(next.membersPagination.page, 3);
        assert.deepEqual(
          next.members.map((row) => row.member_id),
          ids(html, "member"),
        );
        const last = await read(s.db, all, 9999999, 9999999);
        assert.equal(last.editionsPagination.page, 4);
        assert.equal(last.membersPagination.page, 4);
        assert.equal(last.editionsPagination.params.members_page, "4");
        assert.equal(last.membersPagination.params.editions_page, "4");
        const filterForm = /<form method="get" action="\/admin\/archive-statistics"[\s\S]*?<\/form>/.exec(html)[0];
        assert.doesNotMatch(filterForm, /name="(?:editions_page|members_page)"/);
        assert.match(filterForm, /<option value="2024" selected>/);
        assert.doesNotMatch(filterForm, /name="production_id"/);
        assert.match(filterForm, /<option value="public" selected>/);
        assert.doesNotMatch(html, /data-paginate=/);
      });

      await t.test("review samples omit invalid timestamps, negative duration and automatic rows", async () => {
        await s.db.batch([
          s.db.prepare("UPDATE resource SET reviewed_by=1,reviewed_at='not-a-time' WHERE id=1"),
          s.db.prepare("UPDATE resource SET reviewed_by=1,reviewed_at='2026-08-31 23:00:00' WHERE id=3"),
          s.db.prepare("UPDATE resource SET reviewed_by=1,reviewed_at='2026-09-01 12:00:00' WHERE id=5"),
          s.db.prepare("UPDATE resource SET reviewed_by=NULL,reviewed_at='2026-09-01 12:00:00' WHERE id=7"),
        ]);
        const data = await read(s.db);
        assert.equal(data.reviews.manual_samples, 2);
        assert.ok(Math.abs(data.reviews.average_review_hours - 5) < 0.0001);
      });

      await t.test("stored titles, edition names and member names are HTML escaped", async () => {
        const payload = '<img src=x onerror="window.archiveInjected=1">&';
        await s.db.batch([
          s.db.prepare("UPDATE production SET title=? WHERE id=1").bind(payload),
          s.db.prepare("UPDATE production_edition SET name=? WHERE id=1").bind(payload),
          s.db.prepare("UPDATE member SET name=? WHERE id=1").bind(payload),
        ]);
        const response = await s.request("/admin/archive-statistics?year=2024&production_id=1&visibility=public");
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /&lt;img src=x onerror=&quot;window\.archiveInjected=1&quot;&gt;&amp;/);
        assert.doesNotMatch(html, /<img src=x|<script>window\.archiveInjected/);
        assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
      });
    } finally {
      await s.mf.dispose();
    }
  },
);
