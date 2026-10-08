// Code 128 format data, least-significant module first. Ported from the
// independently verified stdlib renderer in the neighboring Python project.
const PATTERNS = [
  0x19b, 0x1b3, 0x333, 0xc9, 0x189, 0x191, 0x99, 0x119, 0x131,
  0x93, 0x113, 0x123, 0x1cd, 0x1d9, 0x399, 0x19d, 0x1b9, 0x339,
  0x273, 0x1d3, 0x393, 0x13b, 0x173, 0x3b7, 0x197, 0x1a7, 0x327,
  0x137, 0x167, 0x267, 0xdb, 0x31b, 0x363, 0xc5, 0xd1, 0x311,
  0x8d, 0xb1, 0x231, 0x8b, 0xa3, 0x223, 0xed, 0x38d, 0x3b1,
  0xdd, 0x31d, 0x371, 0x377, 0x38b, 0x3a3, 0xbb, 0x23b, 0x3bb,
  0xd7, 0x317, 0x347, 0xb7, 0x237, 0x2c7, 0x2f7, 0x213, 0x28f,
  0x65, 0x185, 0x69, 0x309, 0x1a1, 0x321, 0x4d, 0x10d, 0x59,
  0x219, 0x161, 0x261, 0x243, 0x53, 0x2ef, 0x143, 0x2f1, 0x1e5,
  0x1e9, 0x3c9, 0x13d, 0x179, 0x279, 0x12f, 0x14f, 0x24f, 0x3db,
  0x37b, 0x36f, 0xf5, 0x3c5, 0x3d1, 0xbd, 0x23d, 0xaf, 0x22f,
  0x3dd, 0x3bd, 0x3d7, 0x3af, 0x10b, 0x4b, 0x1cb, 0x1ae3,
];

export function validateBarcode(value) {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,256}$/.test(value)) {
    throw new Error('Invalid Code 128 identifier');
  }
  return value;
}

export function encode(value) {
  validateBarcode(value);
  let codes;
  if (/^[0-9]{4,}$/.test(value)) {
    const paired = value.length - value.length % 2;
    codes = [105];
    for (let i = 0; i < paired; i += 2) codes.push(Number(value.slice(i, i + 2)));
    if (paired !== value.length) codes.push(100, value.charCodeAt(value.length - 1) - 32);
  } else {
    codes = [104, ...Array.from(value, char => char.charCodeAt(0) - 32)];
  }
  const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  return [...codes, checksum, 106];
}

export function barcodeGeometry(value, moduleWidth = 3, height = 160) {
  if (!Number.isInteger(moduleWidth) || moduleWidth < 1 || !Number.isInteger(height) || height < 20) {
    throw new Error('Invalid barcode dimensions');
  }
  const bits = encode(value).flatMap(code => Array.from({ length: code === 106 ? 13 : 11 },
    (_, bit) => Boolean(PATTERNS[code] & (1 << bit))));
  const bars = [];
  let start = 0;
  while (start < bits.length) {
    let end = start + 1;
    while (end < bits.length && bits[end] === bits[start]) end++;
    if (bits[start]) bars.push({ x: (start + 10) * moduleWidth, width: (end - start) * moduleWidth });
    start = end;
  }
  return { width: (bits.length + 20) * moduleWidth, height: height + 20, barHeight: height, bars };
}

export function barcodeSvg(value) {
  const geometry = barcodeGeometry(value);
  const bars = geometry.bars.map(bar => `<rect x="${bar.x}" y="10" width="${bar.width}" height="${geometry.barHeight}"/>`).join('');
  // No supplied text is interpolated into markup. Ampersands and leading zeros
  // are encoded in the bars, rather than being removed or parsed as a number.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-label="Code 128 membership barcode"><rect width="100%" height="100%" fill="white"/><g fill="black" shape-rendering="crispEdges">${bars}</g></svg>`;
}
