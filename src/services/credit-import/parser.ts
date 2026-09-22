import { inflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import readWorkbook from "read-excel-file/universal";
import { IMPORT_SCHEMA as schema, ImportError, personKey, type ImportRow } from "./schema";

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Validate ZIP sizes before allocation; rebuild a simple archive for the XLSX reader. */
export function safeWorkbook(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new ImportError("XLSX 压缩包格式不正确。");
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (!count || count > 100 || count !== view.getUint16(end + 8, true) || start + size !== end)
    throw new ImportError("不支持分卷、ZIP64 或过于复杂的工作簿。");
  const files: Record<string, Uint8Array> = Object.create(null);
  let offset = start,
    expanded = 0;
  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new ImportError("XLSX 目录已损坏。");
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      length = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true),
      extraLength = view.getUint16(offset + 30, true),
      comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extraLength + comment > end || local + 30 > start)
      throw new ImportError("XLSX 目录范围错误。");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    expanded += length;
    if (flags & 1 || ![0, 8].includes(method) || length > 2 * 1024 * 1024 || expanded > schema.maxExpandedBytes)
      throw new ImportError("工作簿已加密或解压后内容过大。", 413);
    if (!name || name.includes("..") || /[\\\u0000]/.test(name) || name.startsWith("/") || name in files)
      throw new ImportError("工作簿包含无效或重复的文件路径。");
    if (/vba|macrosheet|externalLink|embedding|activeX/i.test(name) || !/\.(xml|rels)$/.test(name))
      throw new ImportError("请上传不含宏、图片、附件和外部链接的标准 XLSX 模板。");
    if (
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 6, true) !== flags
    )
      throw new ImportError("XLSX 文件头与目录不一致。");
    const ln = view.getUint16(local + 26, true),
      le = view.getUint16(local + 28, true),
      dataStart = local + 30 + ln + le;
    if (dataStart + compressed > start || decoder.decode(bytes.subarray(local + 30, local + 30 + ln)) !== name)
      throw new ImportError("XLSX 文件内容范围错误。");
    if (intervals.some(([a, b]) => local < b && dataStart + compressed > a))
      throw new ImportError("XLSX 文件内容重叠。");
    intervals.push([local, dataStart + compressed]);
    const packed = bytes.subarray(dataStart, dataStart + compressed);
    const unpacked =
      method === 0
        ? packed
        : inflateRawSync(packed, { maxOutputLength: Math.max(1, Math.min(length + 1, 2 * 1024 * 1024)) });
    if (unpacked.length !== length) throw new ImportError("XLSX 文件实际大小与声明不一致。");
    const xml = decoder.decode(unpacked);
    if (
      /<!DOCTYPE|<!ENTITY|<(?:\w+:)?(?:f|mergeCell|mergeCells|oleObject)\b|TargetMode\s*=\s*["']External["']|macroEnabled/i.test(
        xml,
      )
    )
      throw new ImportError("模板禁止公式、合并单元格、宏和外部链接。");
    // Relationships may point a worksheet at any ZIP entry. Detect worksheet XML by
    // its root element so relocating it cannot bypass the sparse-coordinate guard.
    if (/<(?:[\w.-]+:)?worksheet\b/.test(xml)) {
      let cellCount = 0;
      for (const cell of xml.matchAll(/<(?:[\w.-]+:)?c\b([^>]*)>/g)) {
        const address = /\br\s*=\s*(["'])([^"']*)\1/.exec(cell[1])?.[2];
        const coordinate = address && /^([A-P])([1-9]\d{0,3})$/.exec(address);
        // Reject entity-encoded coordinates too, before the XML reader expands them.
        if (!coordinate || Number(coordinate[2]) > 1024 || ++cellCount > 4096)
          throw new ImportError("工作表单元格范围过大或坐标不正确。");
      }
      for (const match of xml.matchAll(/\b(?:r|ref)\s*=\s*(["'])([^"']*)\1/g)) {
        const reference = match[2];
        if (
          !/^(?:[1-9]\d{0,3}|[A-P][1-9]\d{0,3}(?::[A-P][1-9]\d{0,3})?)$/.test(reference) ||
          [...reference.matchAll(/\d+/g)].some((n) => Number(n[0]) > 1024)
        )
          throw new ImportError("工作表范围过大或坐标不正确，请使用标准模板。");
      }
    }
    files[name] = unpacked;
    offset += 46 + nameLength + extraLength + comment;
  }
  if (offset !== end || !files["xl/workbook.xml"] || !files["[Content_Types].xml"])
    throw new ImportError("不是有效的 XLSX 工作簿。");
  return new Uint8Array(zipSync(files, { level: 0 }));
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const field = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 4) throw new ImportError("表格只允许标准模板的 4 列。");
  };
  const line = () => {
    field();
    rows.push(row);
    row = [];
    if (rows.length > 1024) throw new ImportError("表格行数过多。");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === ",") field();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (c === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new ImportError("CSV 引号格式不正确。");
      cell += c;
    }
    if (cell.length > 1000) throw new ImportError("单元格过长，请使用标准模板。");
  }
  if (quoted) throw new ImportError("CSV 引号未闭合。");
  if (cell || row.length || closed) line();
  return rows;
}

export async function parseImport(file: File): Promise<ImportRow[]> {
  if (!file.size || file.size > schema.maxBytes) throw new ImportError("请选择不超过 5MB 的 CSV 或 XLSX 文件。", 413);
  let cells: unknown[][];
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.csv$/i.test(file.name)) cells = parseCsv(decoder.decode(bytes).replace(/^\uFEFF/, ""));
    else if (/\.xlsx$/i.test(file.name)) {
      const sheets = await readWorkbook(safeWorkbook(bytes).buffer, { trim: false, parseNumber: (s) => s });
      const input = sheets.find((s) => s.sheet === schema.sheet),
        guide = sheets.find((s) => s.sheet === schema.guide);
      if (sheets.length !== 2 || !input || !guide || String(guide.data[2]?.[1]) !== String(schema.version))
        throw new ImportError("请使用本站 v1 模板，保留“演职人员导入”和“填写说明”工作表。");
      cells = input.data;
    } else throw new ImportError("只支持 .xlsx 和 UTF-8 .csv 文件。");
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("文件无法解析，请检查 UTF-8 编码或重新另存为标准 XLSX。");
  }
  const header = cells[0] || [];
  if (
    header.length !== schema.fields.length ||
    schema.fields.some((f, i) => String(header[i] ?? "").trim() !== f.title)
  )
    throw new ImportError("表头不匹配，请下载本站 v1 模板并保留列顺序。");
  const result: ImportRow[] = [];
  for (let index = 1; index < cells.length; index++) {
    const source = cells[index] || [];
    if (source.every((v) => v == null || String(v).trim() === "")) continue;
    // Only the exact, unmodified example is skipped. Edited/deleted examples cannot swallow a real row.
    if (index === 1 && schema.fields.every((f, i) => source[i] === f.example)) continue;
    if (result.length >= schema.maxRows) throw new ImportError("一次最多导入 50 行（不含表头和示例）。");
    const values = schema.fields.map((_, i) => String(source[i] ?? "").trim());
    const errors: string[] = [];
    if (source.length > 4) errors.push("存在多余列");
    schema.fields.forEach((f, i) => {
      if (f.required && !values[i]) errors.push(`${f.title.replace("*", "")}必填`);
      if (values[i].length > f.max) errors.push(`${f.title.replace("*", "")}最多 ${f.max} 字`);
      if (
        /[\u0000-\u001f\u007f]/.test(values[i]) ||
        /^[=+@]/.test(values[i]) ||
        (source[i] != null && typeof source[i] !== "string")
      )
        errors.push(`${f.title.replace("*", "")}须为普通文本`);
    });
    const [name, external, kind, role] = values;
    const storedName = name.slice(0, 50);
    const storedExternal = external.slice(0, 80) || null;
    if (!Object.hasOwn(schema.kinds, kind)) errors.push("类别只能为演员或后台与创作");
    if (external && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(external))
      errors.push("外部ID仅允许英文字母、数字、点、下划线、冒号和连字符");
    result.push({
      row_number: index + 1,
      person_key: personKey(storedName, storedExternal),
      member_name: storedName,
      external_id: storedExternal,
      kind: Object.hasOwn(schema.kinds, kind) ? schema.kinds[kind] : kind.slice(0, 20),
      role_name: role.slice(0, 80),
      input_error: errors.join("；"),
      choice: "auto",
      matched_member_id: null,
      resolution: errors.length ? "error" : "unresolved",
      error_code: errors.length ? "invalid" : "",
      error_message: errors.join("；"),
      generated_external_id: null,
      expected_member_revision: null,
    });
  }
  if (!result.length) throw new ImportError("没有可导入的数据，请从第 3 行起填写。");
  return result;
}
