import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const zUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

function modelSphere(mesh) {
  const axes = [[], [], []];
  const point = new THREE.Vector3();
  const stride = Math.max(1, Math.ceil(mesh.numSplats / 12000));
  // Read only the samples used for framing, rather than decoding every splat.
  for (let index = 0; index < mesh.numSplats; index += stride) {
    const { center, opacity } = mesh.packedSplats.getSplat(index);
    if (opacity < 0.08) continue;
    point.copy(center).applyMatrix4(mesh.matrix);
    axes[0].push(point.x);
    axes[1].push(point.y);
    axes[2].push(point.z);
  }
  const box = new THREE.Box3();
  if (axes[0].length < 10) {
    box.copy(mesh.getBoundingBox(true)).applyMatrix4(mesh.matrix);
  } else {
    // Ignore distant floaters when deciding where the default orbit should center.
    for (const axis of axes) axis.sort((a, b) => a - b);
    const last = axes[0].length - 1;
    box.min.fromArray(axes.map((axis) => axis[Math.floor(last * 0.08)]));
    box.max.fromArray(axes.map((axis) => axis[Math.ceil(last * 0.92)]));
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius, 0.001);
  return sphere;
}

export function createSplatViewer(viewport) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance" });
  } catch {
    throw new Error("此浏览器无法启动三维预览。可以试用开启图形加速的 Chrome 或 Edge。");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#171512");
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  camera.position.set(3, 2, 4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.85;
  controls.autoRotateSpeed = 0.85;

  let frame = 0;
  let last = 0;
  let disposed = false;
  let preparing = true;
  let mesh;
  let sphere;
  const redraw = () => {
    if (frame || disposed || preparing) return;
    frame = requestAnimationFrame((time) => {
      frame = 0;
      controls.update(Math.min((time - last) / 1000, 1 / 30));
      last = time;
      renderer.render(scene, camera);
      if (controls.autoRotate) redraw();
    });
  };
  const spark = new SparkRenderer({ renderer, enableLod: false, onDirty: redraw });
  scene.add(spark);
  viewport.append(renderer.domElement);
  controls.addEventListener("change", redraw);
  const resize = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height || disposed) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    redraw();
  });
  resize.observe(viewport);

  function setView(view) {
    const { center, radius } = sphere;
    const direction = new THREE.Vector3(
      ...(view === "top" ? [0, 1, 0.001] : view === "front" ? [0, 0, 1] : [0.65, 0.35, 1]),
    ).normalize();
    const angle = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = (radius * 1.08) / Math.sin(Math.min(angle, Math.atan(Math.tan(angle) * camera.aspect)));
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance * (view === "wide" ? 1 : 0.56));
    controls.minDistance = radius * 0.015;
    controls.maxDistance = distance * 5;
    camera.near = radius * 0.003;
    camera.far = distance * 12;
    camera.updateProjectionMatrix();
    controls.update();
    redraw();
  }

  return {
    async load(download, signal) {
      const { stream, size, timing } = download;
      timing.decodeStartedAt = performance.now();
      // Spark's worker chunk callback does not catch rejected reader.read().
      // End its stream on transport failure, then surface the original error here.
      const reader = stream.getReader();
      let streamError;
      const loaderStream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              reader.releaseLock();
              controller.close();
            } else controller.enqueue(value);
          } catch (error) {
            streamError = error;
            reader.releaseLock();
            controller.close();
          }
        },
        cancel(reason) {
          return reader.cancel(reason).catch(() => {});
        },
      });
      const candidate = new SplatMesh({
        stream: loaderStream,
        streamLength: size,
        fileName: "model.ply",
        lod: false,
        editable: false,
        raycastable: false,
      });
      try {
        await candidate.initialized;
        if (streamError) throw streamError;
        signal.throwIfAborted();
        timing.initializedAt = performance.now();
        if (!candidate.numSplats) throw new Error("模型中没有可显示的数据。");
        candidate.applyMatrix4(zUp);
        sphere = modelSphere(candidate);
        timing.framedAt = performance.now();
        mesh = candidate;
        scene.add(mesh);
        setView("reset");
        await spark.update({ scene, camera });
        signal.throwIfAborted();
        renderer.render(scene, camera);
        await new Promise((resolve, reject) => {
          const abort = () => {
            cancelAnimationFrame(id);
            reject(signal.reason);
          };
          const id = requestAnimationFrame(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          });
          signal.addEventListener("abort", abort, { once: true });
        });
        signal.throwIfAborted();
        timing.readyAt = performance.now();
        preparing = false;
        redraw();
        return { ...timing, splats: candidate.numSplats };
      } catch (error) {
        candidate.dispose();
        throw error;
      }
    },
    act(action) {
      if (!sphere) return false;
      if (action === "spin") {
        controls.autoRotate = !controls.autoRotate;
      } else if (action === "in" || action === "out") {
        const offset = camera.position.clone().sub(controls.target);
        const distance = THREE.MathUtils.clamp(
          offset.length() * (action === "in" ? 0.8 : 1.25),
          controls.minDistance,
          controls.maxDistance,
        );
        camera.position.copy(controls.target).add(offset.setLength(distance));
        controls.update();
      } else {
        controls.autoRotate = false;
        setView(action);
      }
      redraw();
      return controls.autoRotate;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      if (mesh) scene.remove(mesh);
      mesh?.dispose();
      spark.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
