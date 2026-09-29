import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const host = document.querySelector("#system-scene");
const live = document.querySelector("#system-live");
const modules = {
  web: {
    title: "浏览器 / 前端",
    description: "服务端 HTML 与原生 JavaScript 渐进增强。用户操作经 Worker 接口处理，浏览器不能直接查询 D1。",
    source: "src/views.ts、public/app.js",
    section: "system-flows",
    position: [-5, 0, 2],
    label: "浏览器",
  },
  assets: {
    title: "ASSETS / 静态资源",
    description: "提供本地打包的脚本、样式和图片；文件名包含内容哈希。系统地图没有使用外部 CDN。",
    source: "scripts/build-assets.mjs、src/index.ts",
    section: "system-report",
    position: [-5, 0, -3],
    label: "ASSETS",
  },
  worker: {
    title: "Cloudflare Worker",
    description:
      "Hono 处理服务端页面与接口；签名会话经数据库复核，再检查业务权限和 CSRF。后台页面与数据接口均校验管理员身份。",
    source: "src/index.ts、src/middleware/session.ts、src/routes/admin.ts",
    section: "system-report",
    position: [0, 0, 0],
    label: "Worker",
  },
  db: {
    title: "DB / D1 数据库",
    description:
      "保存作品、队员、认证、审核、演职人员及上传台账。下方关系图只使用当前 DB 查询返回的外键，字段列表不读取业务行。",
    source: "migrations、src/services/system-info.ts",
    section: "system-database",
    position: [5, 0, -3],
    label: "D1",
  },
  r2: {
    title: "FILES / R2 资源桶",
    description:
      "存放资料原文件、预览图、头像与展示图片。Worker 经业务权限校验读取；配置齐全时可签名直传。平台对象数、已用和剩余容量目前不可获取。",
    source: "src/services/resource-files.ts、src/services/uploads.ts",
    section: "system-storage",
    position: [5, 0, 3],
    label: "R2",
  },
};
let selected = "worker",
  sceneState;
function select(id) {
  selected = id;
  const item = modules[id];
  document.querySelector("#node-title").textContent = item.title;
  document.querySelector("#node-description").textContent = item.description;
  document.querySelector("#node-evidence").textContent = "代码来源：" + item.source;
  const link = document.querySelector("#node-section");
  link.href = {
    "system-report": "/admin/system/architecture#system-report",
    "system-flows": "/admin/system/flows",
    "system-database": "/admin/system/database",
    "system-storage": "/admin/system/storage",
  }[item.section];
  link.textContent = {
    "system-report": "查看分析报告 →",
    "system-flows": "查看业务流 →",
    "system-database": "查看表结构 →",
    "system-storage": "查看资源桶信息 →",
  }[item.section];
  document
    .querySelectorAll("[data-scene-node]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sceneNode === id)));
  updateLive();
  sceneState?.highlight();
}
function updateLive() {
  const meta = live.querySelector("[data-system-meta]");
  const target = document.querySelector("#node-live");
  if (!meta) {
    target.textContent = "实时状态尚未获取；请查看下方加载或错误提示。";
    return;
  }
  const time = " · 查询于 " + meta.dataset.checked + " UTC";
  target.textContent =
    selected === "db"
      ? (meta.dataset.dbStatus === "error"
          ? "数据库结构查询失败"
          : "结构查询成功 · " + meta.dataset.tableCount + " 张表") + time
      : selected === "r2"
        ? (meta.dataset.r2Status === "ok" ? "HEAD 检查成功 · 仅代表连接可用" : "R2 连接查询失败") + time
        : "代码或配置已确认；线上部署版本与实际流量未核实。";
}
function buildScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-11, 11, 8, -8, 0.1, 100);
  camera.position.set(14, 14, 18);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.minZoom = 0.65;
  controls.maxZoom = 2;
  controls.enablePan = false;
  controls.minPolarAngle = 0.45;
  controls.maxPolarAngle = 1.15;
  controls.update();
  controls.saveState();
  scene.add(new THREE.HemisphereLight(0xffefd0, 0x2e2925, 2.5));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-8, 15, 10);
  scene.add(light);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.28, 11),
    new THREE.MeshStandardMaterial({ color: 0x35312a, roughness: 0.85 }),
  );
  floor.position.y = -0.3;
  scene.add(floor);
  const grid = new THREE.GridHelper(16, 16, 0x695743, 0x494039);
  grid.position.y = -0.14;
  scene.add(grid);
  const clickables = [],
    blocks = {},
    edges = [];
  const mesh = (geo, color, group, y) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25 }));
    m.position.y = y;
    group.add(m);
    return m;
  };
  for (const [id, item] of Object.entries(modules)) {
    const group = new THREE.Group();
    group.position.set(...item.position);
    scene.add(group);
    mesh(new THREE.BoxGeometry(3.1, 0.3, 2.8), 0x74634c, group, 0.05);
    const body = mesh(
      id === "db" || id === "r2"
        ? new THREE.CylinderGeometry(1, 1, 1.8, 40)
        : new THREE.BoxGeometry(2.1, id === "worker" ? 2 : 1.3, 1.6),
      id === "worker" ? 0xc5a15a : 0x827763,
      group,
      1.05,
    );
    body.userData.id = id;
    clickables.push(body);
    blocks[id] = body;
    for (let i = 0; i < 3; i++)
      mesh(
        id === "db" || id === "r2"
          ? new THREE.CylinderGeometry(1.05, 1.05, 0.09, 40)
          : new THREE.BoxGeometry(2.2, 0.07, 1.7),
        0xdbc089,
        group,
        0.5 + i * 0.5,
      );
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 256;
    textureCanvas.height = 80;
    const ctx = textureCanvas.getContext("2d");
    ctx.fillStyle = "#ede2c9";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(item.label, 128, 45);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(textureCanvas), depthTest: false }),
    );
    sprite.position.set(0, 3, 0);
    sprite.scale.set(3, 0.94, 1);
    group.add(sprite);
  }
  for (const [a, b] of [
    ["web", "worker"],
    ["assets", "worker"],
    ["worker", "db"],
    ["worker", "r2"],
  ]) {
    const start = new THREE.Vector3(...modules[a].position),
      end = new THREE.Vector3(...modules[b].position);
    start.y = end.y = 0.24;
    const points = [start, new THREE.Vector3(end.x, 0.24, start.z), end];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x8f7955 }),
    );
    scene.add(line);
    edges.push({ a, b, line });
    const dir = end.clone().sub(points[1]);
    if (dir.length() < 0.01) dir.copy(end).sub(start);
    const arrow = new THREE.ArrowHelper(
      dir.normalize(),
      end.clone().addScaledVector(dir, -0.75),
      0.6,
      0xdbc089,
      0.35,
      0.25,
    );
    scene.add(arrow);
    edges.at(-1).arrow = arrow;
  }
  host.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  function render() {
    renderer.render(scene, camera);
  }
  function resize() {
    const width = host.clientWidth,
      height = host.clientHeight;
    const aspect = width / height;
    const extent = aspect < 1 ? 10 : 7.5;
    camera.left = -extent * aspect;
    camera.right = extent * aspect;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    render();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  controls.addEventListener("change", render);
  const paths = {
    all: Object.keys(modules),
    upload: ["web", "worker", "db", "r2"],
    read: ["web", "worker", "db", "r2"],
    member: ["web", "worker", "db"],
  };
  function highlight() {
    const active = paths[document.querySelector("#system-path").value];
    for (const [id, body] of Object.entries(blocks)) {
      body.material.emissive.set(id === selected ? 0x79511a : 0);
      body.material.color.set(active.includes(id) ? (id === "worker" ? 0xc5a15a : 0x827763) : 0x443e35);
    }
    edges.forEach(({ a, b, line, arrow }) => {
      const color = active.includes(a) && active.includes(b) ? 0xe7bb64 : 0x494039;
      line.material.color.set(color);
      arrow.setColor(color);
    });
    render();
  }
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let down;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener("pointercancel", () => {
    down = null;
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) {
      down = null;
      return;
    }
    down = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, (-(e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(clickables)[0];
    if (hit) select(hit.object.userData.id);
  });
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    document.querySelector("#scene-message").textContent = "图形上下文已失效，请刷新页面；模块按钮与字段信息仍可使用。";
  });
  document.querySelector("#scene-reset").addEventListener("click", () => {
    controls.reset();
    resize();
  });
  document.querySelectorAll("[data-scene-zoom]").forEach((b) =>
    b.addEventListener("click", () => {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (b.dataset.sceneZoom === "in" ? 1.2 : 1 / 1.2), 0.65, 2);
      camera.updateProjectionMatrix();
      render();
    }),
  );
  document.querySelector("#system-path").addEventListener("change", highlight);
  window.addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return;
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
    },
    { once: true },
  );
  sceneState = { highlight };
  resize();
  highlight();
}

if (host && live) {
  document
    .querySelectorAll("[data-scene-node]")
    .forEach((b) => b.addEventListener("click", () => select(b.dataset.sceneNode)));
  document.querySelector("#node-section").addEventListener("click", () => {
    const target = document.getElementById(modules[selected].section);
    if (target instanceof HTMLDetailsElement) target.open = true;
  });
  try {
    buildScene();
  } catch {
    document.querySelector("#scene-message").textContent =
      "当前浏览器无法显示立体地图；请使用模块按钮查看详情，所有数据仍在下方提供。";
    host.querySelector(".scene-fallback")?.remove();
  }
  const observer = new MutationObserver(() => {
    updateLive();
  });
  observer.observe(live, { childList: true });
  select(selected);
}
