import * as pdfjsLib from '../lib/vendor/pdfjs/pdf.min.mjs';

export function pageMayHaveColoredBackground(opList) {
  const OPS = pdfjsLib.OPS;
  if (!opList || !opList.fnArray || !OPS) return true;
  const colorOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
    OPS.shadingFill, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject, OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintImageMaskXObjectGroup, OPS.paintFormXObjectBegin, OPS.beginGroup].filter((v) => v != null));
  return opList.fnArray.some((fn) => colorOps.has(fn));
}
