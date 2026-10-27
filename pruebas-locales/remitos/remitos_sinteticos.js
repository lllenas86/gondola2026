// Remitos sintéticos dibujados en canvas (mismo código en el navegador y en Playwright).
// tipo: 'legible' | 'danado' | 'ilegible'  → devuelve data URL JPEG
window.generarRemito = function (tipo) {
  const W = 900, H = 1200;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // semilla fija para que el "daño" sea reproducible
  let s = 42; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const datos = tipo === 'legible' ? {
    prov: 'DISTRIBUIDORA CENTRO S.R.L.', dir: 'Bv. San Juan 1450 - Córdoba', nro: 'REMITO N° 0001-00004512', fecha: '24/10/2026',
    filas: [['12', 'COCA COLA 2,25 LT', ''], ['24', 'COCA COLA 500 CC', ''], ['6', 'SPRITE 2,25 LT', ''], ['10', 'AGUA MINERAL 1,5 LT', '15/03/2027']],
  } : {
    prov: 'LACTEOS DEL SUR', dir: 'Ruta 9 km 12 - Córdoba', nro: 'REMITO N° 0003-00000877', fecha: '15/11/2026',
    filas: [['30', 'LECHE ENTERA 1 L', '05/11/2026'], ['18', 'YOGUR BEBIBLE 190 G', '08/11/2026'], ['5', 'QUESO RALLADO 150 G', '20/12/2026']],
  };

  g.fillStyle = tipo === 'legible' ? '#ffffff' : '#ece4d0'; g.fillRect(0, 0, W, H);
  if (tipo !== 'legible') { g.save(); g.translate(W / 2, H / 2); g.rotate(0.06); g.translate(-W / 2, -H / 2); }
  const tinta = tipo === 'legible' ? '#111' : '#4a4a55';
  g.fillStyle = tinta; g.strokeStyle = tinta; g.lineWidth = 2;
  g.font = 'bold 38px Arial'; g.fillText(datos.prov, 60, 100);
  g.font = '24px Arial'; g.fillText(datos.dir, 60, 140);
  g.font = 'bold 30px Arial'; g.fillText(datos.nro, 60, 210);
  g.font = '28px Arial'; g.fillText('Fecha: ' + datos.fecha, 60, 260);
  g.fillText('Cliente: Almacén Don Pepe', 60, 305);
  g.strokeRect(50, 340, 800, 70 + datos.filas.length * 70);
  g.font = 'bold 26px Arial'; g.fillText('Cant.', 70, 385); g.fillText('Descripción', 200, 385); g.fillText('Vto.', 680, 385);
  g.beginPath(); g.moveTo(50, 405); g.lineTo(850, 405); g.stroke();
  g.font = '28px "Courier New", monospace';
  datos.filas.forEach((f, i) => { const y = 455 + i * 70; g.fillText(f[0], 80, y); g.fillText(f[1], 200, y); g.fillText(f[2], 640, y); });
  g.font = '22px Arial'; g.fillText('Recibí conforme: ____________________', 60, 1050);
  if (tipo !== 'legible') g.restore();

  if (tipo !== 'legible') {
    // arrugas
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = `rgba(80,70,50,${0.15 + rnd() * 0.25})`; g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); let x = rnd() * W, y = rnd() * H; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 300; y += (rnd() - 0.3) * 250; g.lineTo(x, y); } g.stroke();
    }
    // mancha de café sobre la cantidad del yogur y parte de la fecha
    const mancha = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r); gr.addColorStop(0, `rgba(110,70,30,${a})`); gr.addColorStop(1, 'rgba(110,70,30,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    mancha(115, 535, 70, 0.85); mancha(260, 250, 55, 0.5); mancha(700, 700, 120, 0.45);
    // ruido
    const im = g.getImageData(0, 0, W, H); const d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 70; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(im, 0, 0);
  }
  let out = c;
  const desenfoque = tipo === 'danado' ? 1.6 : tipo === 'ilegible' ? 14 : 0;
  if (desenfoque) {
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d'); g2.filter = `blur(${desenfoque}px) contrast(${tipo === 'ilegible' ? 0.35 : 0.8})`; g2.drawImage(c, 0, 0); out = c2;
  }
  // baja resolución para el dañado e ilegible
  if (tipo !== 'legible') {
    const c3 = document.createElement('canvas'); c3.width = 600; c3.height = 800;
    c3.getContext('2d').drawImage(out, 0, 0, 600, 800); out = c3;
  }
  return out.toDataURL('image/jpeg', tipo === 'legible' ? 0.9 : 0.45);
};
