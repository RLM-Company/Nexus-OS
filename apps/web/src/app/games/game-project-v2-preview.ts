import type { GameProjectV2 } from "@cosmora/contracts/game-project-v2";
import { staticSiteDocument } from "../sites/site-preview";
import { render3D } from "./game-3d-renderer";
import { v2SceneDescriptor } from "./game-project-v2-edits";

export function gameProjectResources(doc: Document, project: GameProjectV2): HTMLElement {
  const extra = doc.createElement("section");
  extra.setAttribute("aria-label", "Сцены и ресурсы проекта");
  for (const scene of project.scenes) {
    const view = doc.createElement("section");
    const title = doc.createElement("h2");
    title.textContent = scene.title;
    view.append(title);
    const isolated = new DOMParser().parseFromString(staticSiteDocument(scene.html), "text/html");
    for (const element of isolated.body.querySelectorAll("[id], style")) {
      if (element.localName === "style") element.remove();
      else element.removeAttribute("id");
    }
    view.append(...isolated.body.childNodes);
    extra.append(view);
  }
  for (const asset of project.assets) {
    const figure = doc.createElement("figure");
    const caption = doc.createElement("figcaption");
    caption.textContent = asset.name;
    figure.append(caption);
    if (asset.media_type === "text/plain") {
      const text = doc.createElement("pre");
      text.textContent = new TextDecoder().decode(
        Uint8Array.from(atob(asset.data_base64), (part) => part.charCodeAt(0))
      );
      figure.append(text);
    } else {
      const image = doc.createElement("img");
      image.src = `data:${asset.media_type};base64,${asset.data_base64}`;
      image.alt = asset.name;
      image.width = 160;
      figure.append(image);
    }
    extra.append(figure);
  }
  return extra;
}

export function createObjSceneDocument(project: GameProjectV2): string {
  const model = project.model;
  if (model?.format !== "obj-lite")
    throw new Error("Для просмотра 3D нужен model в формате OBJ-lite.");
  const doc = new DOMParser().parseFromString(
    staticSiteDocument(project.files.scene_html),
    "text/html"
  );
  const heading = doc.createElement("h1");
  heading.textContent = project.title;
  doc.body.prepend(heading);

  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не поддерживает Canvas 2D.");
  try {
    const descriptor = v2SceneDescriptor(project);
    render3D(
      context,
      {
        model: { ...model, format: "obj-lite" },
        rotation: descriptor.rotation,
        scale: descriptor.scale
      },
      canvas.width,
      canvas.height
    );
  } catch {
    throw new Error(
      `Не удалось отобразить ${model.name}. OBJ-lite поддерживает вершины v и треугольники f.`
    );
  }
  const image = doc.createElement("img");
  image.alt = `Модель OBJ-lite: ${model.name}`;
  image.src = canvas.toDataURL();
  image.width = 800;
  image.height = 500;
  const status = doc.createElement("p");
  status.textContent = "Снимок сцены на момент экспорта (с учётом поворота и масштаба из проекта)";
  doc.body.append(status, image, gameProjectResources(doc, project));
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
