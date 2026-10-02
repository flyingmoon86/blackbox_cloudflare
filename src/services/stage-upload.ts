import { inspectStagePng, stageFields, stageScenes, stageSettings } from "./stage-visuals";

export async function prepareStageUpdate(form: FormData, texts: Record<string, string>) {
  const settings = stageSettings(JSON.stringify(texts));
  const uploads: Array<{ key: string; bytes: Uint8Array }> = [];
  let total = 0;
  for (const scene of stageScenes) {
    if (!form.has(`stage_${scene}_intensity`)) continue;
    const config = settings[scene];
    for (const field of stageFields) {
      const raw = form.get(`stage_${scene}_${field}`),
        n = Number(raw);
      if (raw === null || raw === "" || !Number.isFinite(n) || n < 0 || n > 100)
        throw Error("灯光参数与裁切位置必须在 0–100 之间。");
      config[field] = n;
    }
    config.direction = scene !== "home" && form.get(`stage_${scene}_direction`) === "preset";
    const mode = form.get(`stage_${scene}_pair`);
    if (mode === "builtin") delete config.pair;
    else if (mode === "upload") {
      const files = [form.get(`stage_${scene}_base`), form.get(`stage_${scene}_light`)];
      if (files.some((file) => !(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024))
        throw Error("请同时选择底图与光层，每张 PNG 不超过 8 MB。");
      const [base, light] = files as File[];
      total += base.size + light.size;
      if (total > 32 * 1024 * 1024) throw Error("本次提交的素材总大小不能超过 32 MB。");
      const baseBytes = new Uint8Array(await base.arrayBuffer()),
        lightBytes = new Uint8Array(await light.arrayBuffer());
      const dimensions = inspectStagePng(baseBytes),
        lightDimensions = inspectStagePng(lightBytes, true);
      if (dimensions.width !== lightDimensions.width || dimensions.height !== lightDimensions.height)
        throw Error("底图与光层必须具有完全相同的像素尺寸。");
      const key = crypto.randomUUID();
      config.pair = { key, ...dimensions };
      uploads.push(
        { key: `stage/${key}/unlit.png`, bytes: baseBytes },
        { key: `stage/${key}/light.png`, bytes: lightBytes },
      );
    } else if (mode !== "current") throw Error("请选择有效的成对素材来源。");
  }
  texts.stage_visuals = JSON.stringify(settings);
  return uploads;
}
