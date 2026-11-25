import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeBoxProps {
  value: string;
  size?: number;
  caption?: string;
}

export default function QrCodeBox({ value, size = 168, caption }: QrCodeBoxProps) {
  const [svgMarkup, setSvgMarkup] = useState('');

  useEffect(() => {
    let active = true;
    if (!value) {
      setSvgMarkup('');
      return;
    }
    QRCode.toString(value, {
      type: 'svg',
      width: size,
      margin: 2,
      color: { dark: '#3c2e2a', light: '#ffffff' },
    })
      .then((svg) => {
        if (active) setSvgMarkup(svg);
      })
      .catch(() => {
        if (active) setSvgMarkup('');
      });
    return () => { active = false; };
  }, [value, size]);

  return (
    <div className="qr-code-box">
      <div
        className="qr-code-frame"
        style={{ width: size, height: size }}
        aria-label={caption || '二维码'}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
      {caption && <small className="qr-code-caption">{caption}</small>}
    </div>
  );
}
