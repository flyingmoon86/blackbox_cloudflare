/* 黑匣子 demo — 共享交互（无依赖） */
(function () {
  document.documentElement.classList.add("js");
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 入幕点亮：每幕进入视口后，幕内元素按 --i 依次亮起（仅一次） */
  var acts = document.querySelectorAll(".act");
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-lit"); io.unobserve(en.target); }
      });
    }, { threshold: 0.15 });
    acts.forEach(function (a) { io.observe(a); });
  } else {
    acts.forEach(function (a) { a.classList.add("is-lit"); });
  }

  /* 幕次导航：滚到哪一幕，哪一幕亮 */
  var railLinks = document.querySelectorAll(".scene-rail a");
  if (railLinks.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        railLinks.forEach(function (l) {
          l.setAttribute("aria-current", String(l.hash === "#" + en.target.id));
        });
      });
    }, { rootMargin: "-42% 0px -52% 0px" });
    acts.forEach(function (a) { spy.observe(a); });
  }

  /* 首页导航的 aria-current 由各页 HTML 静态声明，脚本不再干预 */

  /* 队员名录：渲染 + 年级筛选 */
  var grid = document.querySelector("[data-member-grid]");
  if (grid && window.BLACKBOX) {
    var members = window.BLACKBOX.members;
    var flowers = readFlowers();
    grid.innerHTML = members.map(function (m) {
      var bio = m.bio || "点击查看队员档案与舞台经历";
      var f = (flowers[m.id] ? m.flowers + 1 : m.flowers);
      var media = m.av
        ? '<img class="mc-media" src="' + m.av + '" alt="' + m.name + '的照片" loading="lazy" onerror="this.remove()">'
        : '<span class="mc-art" aria-hidden="true"><b>' + m.name.charAt(0) + "</b></span>";
      return (
        '<article class="member-card fx" style="--i:' + (members.indexOf(m) % 8) + '" data-year="' + m.year + '">' +
        '<a href="member.html?id=' + m.id + '" aria-label="' + m.name + " · " + m.cohort + ' · 送花 ' + f + '">' +
        media +
        '<span class="mc-shade"></span>' +
        '<span class="mc-copy">' +
        '<span class="eyebrow2">' + m.cohort + "</span>" +
        "<strong>" + m.name + "</strong>" +
        '<span class="reveal"><span class="mc-bio">' + bio + "</span></span>" +
        '<span class="mc-flowers"><span class="f">✿</span> ' + f + " 朵" +
        '<span class="mc-link">查看档案 →</span></span>' +
        "</span></a></article>"
      );
    }).join("");

    /* 年级筛选 */
    var chips = document.querySelectorAll("[data-filter]");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var year = chip.getAttribute("data-filter");
        chips.forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
        grid.querySelectorAll(".member-card").forEach(function (card) {
          var show = year === "all" || card.getAttribute("data-year") === year;
          card.style.display = show ? "" : "none";
        });
      });
    });
  }

  /* 个人档案：按 ?id= 渲染 */
  var profile = document.querySelector("[data-profile]");
  if (profile && window.BLACKBOX) {
    var id = new URLSearchParams(location.search).get("id");
    var m = window.BLACKBOX.members.find(function (x) { return x.id === id; }) || window.BLACKBOX.members[0];
    var credits = window.BLACKBOX.credits.filter(function (c) { return c.memberId === m.id; });
    document.title = m.name + " · 队员档案 — 黑匣子";

    var portrait = document.querySelector("[data-portrait]");
    portrait.innerHTML = m.av
      ? '<img src="' + m.av + '" alt="' + m.name + '的照片">'
      : '<span class="portrait-fallback">' + m.name.charAt(0) + "</span>";
    if (m.av) {
      var im = portrait.querySelector("img");
      im.addEventListener("error", function () {
        portrait.innerHTML = '<span class="portrait-fallback">' + m.name.charAt(0) + "</span>";
      });
    }

    document.querySelector("[data-name]").textContent = m.name;
    document.querySelector("[data-cohort]").textContent = m.cohort;
    document.querySelector("[data-tags]").innerHTML = m.tags
      .map(function (t) { return '<span class="tag">' + t + "</span>"; }).join(" ");
    document.querySelector("[data-bio]").textContent = m.bio || "这位队员还没有留下介绍，第一个了解 TA 的方式，是去剧场看 TA 的戏。";

    var cg = document.querySelector("[data-credits]");
    if (credits.length) {
      cg.innerHTML = credits.map(function (c) {
        return '<div class="credit-row">' +
          '<span class="role">' + c.role + (c.kind === "crew" ? " · 幕后" : "") + "</span>" +
          '<span class="who"><a href="production.html" style="text-decoration:none">' + c.play + " · " + c.edition + " →</a></span>" +
          "</div>";
      }).join("");
    } else {
      cg.innerHTML = '<div class="empty-state">舞台经历整理中——如果 TA 参演过某部戏，欢迎提醒 TA 来补档。</div>';
    }

    /* 送花：本地演示，真实计数以线上为准 */
    var store = readFlowers();
    var btn = document.querySelector("[data-flower-btn]");
    var countEl = document.querySelector("[data-flower-count]");
    var setCount = function () {
      countEl.textContent = m.flowers + (store[m.id] ? 1 : 0);
    };
    setCount();
    if (store[m.id]) {
      btn.disabled = true;
      btn.textContent = "已送过花 ✿";
    }
    btn.addEventListener("click", function () {
      if (store[m.id]) return;
      store[m.id] = 1;
      localStorage.setItem("bb-flowers", JSON.stringify(store));
      setCount();
      btn.disabled = true;
      btn.textContent = "已送过花 ✿";
      if (!reduce) {
        var box = btn.closest(".flower-box") || btn;
        for (var i = 0; i < 5; i++) {
          var p = document.createElement("span");
          p.className = "petal";
          p.textContent = "✿";
          p.style.setProperty("--dx", (Math.random() * 90 - 45).toFixed(0) + "px");
          p.style.setProperty("--rot", (Math.random() * 120 - 60).toFixed(0) + "deg");
          p.style.animationDelay = i * 70 + "ms";
          p.style.left = "50%";
          p.style.top = "40%";
          box.append(p);
          p.addEventListener("animationend", function (e) { e.target.remove(); });
        }
      }
    });
  }

  function readFlowers() {
    try { return JSON.parse(localStorage.getItem("bb-flowers") || "{}"); }
    catch (e) { return {}; }
  }
})();
