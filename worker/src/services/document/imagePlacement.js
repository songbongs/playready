function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildImageTag(image) {
  const alt = escapeHtml(`${image.page}페이지 이미지`);
  const style = "max-width:100%;height:auto;border-radius:12px;margin:16px 0;";
  return `<figure class="rulebook-image" data-image-id="${escapeHtml(image.id)}"><img src="data:${image.mimeType};base64,${image.base64}" alt="${alt}" style="${style}" /><figcaption>${image.page}페이지 · 좌표 (${image.bbox.x0}, ${image.bbox.y0})</figcaption></figure>`;
}

export function injectImagesIntoHtml(html, images) {
  return html.replace(/\[IMAGE_SLOT:([^\]]+)\]/g, (_, imageId) => {
    const image = images.find((item) => item.id === imageId);
    return image ? buildImageTag(image) : "";
  });
}
