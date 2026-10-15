import qrcode from 'qrcode-generator';

export function paymentQr(address: string): string {
  if (!/^[\x21-\x7e]{1,512}$/.test(address)) throw new Error('Адрес для QR-кода не подтвержден.');
  const code = qrcode(0, 'M');
  code.addData(address, 'Byte');
  code.make();
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(code.createSvgTag({ cellSize: 6, margin: 24 }));
}
