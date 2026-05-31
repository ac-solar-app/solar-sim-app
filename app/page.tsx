"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';

const RoofCanvas = dynamic(() => import('@/components/RoofCanvas'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-gray-100 animate-pulse">Loading Canvas...</div>
});

// ★追加：メーカーごとのパネルデータベース
const PANEL_DATA = {
  "長州産業": [
    { id: "cs-340b61", name: "Premium Blue (340W) 1670×1000", width: 1.67, height: 1.00, kw: 0.34 },
    { id: "cs-285b61", name: "Premium Blue 小型 (285W) 1300×1000", width: 1.30, height: 1.00, kw: 0.285 }
  ],
  "Qセルズ": [
    { id: "q-peak-400", name: "Q.PEAK DUO-G9 (400W) 1673×1030", width: 1.673, height: 1.03, kw: 0.40 },
    { id: "q-peak-355", name: "Q.PEAK DUO-G9 小型 (355W) 1700×1000", width: 1.70, height: 1.00, kw: 0.355 }
  ],
  "パナソニック": [
    { id: "hit-250", name: "HIT P250α Plus (250W) 1580×798", width: 1.58, height: 0.798, kw: 0.25 },
    { id: "hit-120", name: "HIT ハーフ (120W) 790×798", width: 0.79, height: 0.798, kw: 0.12 }
  ],
  "カナディアン・ソーラー": [
    { id: "cs3l-375", name: "HiKu (375W) 1765×1048", width: 1.765, height: 1.048, kw: 0.375 }
  ]
};

const pointToSegmentDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const l2 = (bx - ax)**2 + (by - ay)**2;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
};

const isInsidePolygon = (x: number, y: number, poly: {x: number, y: number}[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const crossProduct = (a: {x:number, y:number}, b: {x:number, y:number}, c: {x:number, y:number}) => {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
};

const doSegmentsIntersect = (p1: {x:number, y:number}, p2: {x:number, y:number}, q1: {x:number, y:number}, q2: {x:number, y:number}) => {
  const cp1 = crossProduct(p1, p2, q1);
  const cp2 = crossProduct(p1, p2, q2);
  const cp3 = crossProduct(q1, q2, p1);
  const cp4 = crossProduct(q1, q2, p2);
  return (((cp1 > 0 && cp2 < 0) || (cp1 < 0 && cp2 > 0)) &&
          ((cp3 > 0 && cp4 < 0) || (cp3 < 0 && cp4 > 0)));
};

export default function Home() {
  const [refLine, setRefLine] = useState<number[]>([]);
  const [areaPoints, setAreaPoints] = useState<number[]>([]);
  
  const [calibLength, setCalibLength] = useState<number>(10);
  const [roofPitch, setRoofPitch] = useState<number>(5.5); 
  const [panelMarginMm, setPanelMarginMm] = useState<number>(500); 

  // ★追加：連動プルダウン用のステート
  const [maker, setMaker] = useState<string>("長州産業");
  const [panelId, setPanelId] = useState<string>("cs-340b61");
  
  const [zipCode, setZipCode] = useState<string>("");
  const [locationInfo, setLocationInfo] = useState({ address: "", station: "" });
  const [azimuth, setAzimuth] = useState<number>(1.0); 
  
  const [resultCount, setResultCount] = useState<number>(0);
  const [resultCapacity, setResultCapacity] = useState<string>("0.00");
  const [placedPanelsCoords, setPlacedPanelsCoords] = useState<Array<number[]>>([]);
  
  const [monthlyGen, setMonthlyGen] = useState<number[]>(Array(12).fill(0));
  const [annualGen, setAnnualGen] = useState<number>(0);

  const [previewPanels, setPreviewPanels] = useState<{x: number, y: number}[]>([]);
  const [readyPanelsPx, setReadyPanelsPx] = useState<Array<number[]>>([]);

  // ★追加：メーカーが変わった時に、そのメーカーの1番目のパネルを自動選択する
  useEffect(() => {
    setPanelId(PANEL_DATA[maker as keyof typeof PANEL_DATA][0].id);
  }, [maker]);

  const validatePanel = (px: number, py: number, pW: number, pH: number, margin: number, poly: {x: number, y: number}[]) => {
    const corners = [
      {x: px, y: py}, {x: px + pW, y: py}, 
      {x: px + pW, y: py + pH}, {x: px, y: py + pH}
    ];
    for (const c of corners) {
      if (!isInsidePolygon(c.x, c.y, poly)) return false;
    }
    for (let i = 0; i < 4; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
        const q1 = poly[k];
        const q2 = poly[j];
        if (doSegmentsIntersect(p1, p2, q1, q2)) return false;
      }
    }
    if (margin > 0) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const ax = poly[j].x, ay = poly[j].y;
        const bx = poly[i].x, by = poly[i].y;
        for (const c of corners) {
          if (pointToSegmentDist(c.x, c.y, ax, ay, bx, by) < margin) return false;
        }
        const cx = Math.max(Math.min(ax, px + pW), px);
        const cy = Math.max(Math.min(ay, py + pH), py);
        const distToRect = Math.hypot(ax - cx, ay - cy);
        if (distToRect < margin) return false;
      }
    }
    return true;
  };

  useEffect(() => {
    const cleanZip = zipCode.replace("-", "").trim();
    if (cleanZip.length >= 7) {
      if (cleanZip === "9800003") {
        setLocationInfo({ address: "宮城県仙台市青葉区中央", station: "仙台（アメダス観測所）" });
      } else if (cleanZip.startsWith("100")) {
        setLocationInfo({ address: "東京都千代田区大手町", station: "東京（千代田区）" });
      } else if (cleanZip.startsWith("360")) {
        setLocationInfo({ address: "埼玉県熊谷市桜木町", station: "熊谷（熊谷気象台）" });
      } else if (cleanZip.startsWith("060")) {
        setLocationInfo({ address: "北海道札幌市中央区北1条", station: "札幌（管区気象台）" });
      } else {
        setLocationInfo({ address: "検索された住所（サンプル）", station: "最寄りの地域気象観測所" });
      }
    } else {
      setLocationInfo({ address: "", station: "" });
    }
  }, [zipCode]);

  useEffect(() => {
    if (refLine.length === 4 && areaPoints.length >= 6) {
      const dx = refLine[2] - refLine[0];
      const dy = refLine[3] - refLine[1];
      const refPxLength = Math.hypot(dx, dy);
      if (refPxLength === 0) return;
      
      const scale = calibLength / refPxLength; 
      const angleRad = Math.atan2(dy, dx);
      const cosTheta = 10 / Math.sqrt(100 + Math.pow(roofPitch, 2));

      const coords = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      for (let i = 0; i < areaPoints.length; i += 2) {
        const px = areaPoints[i];
        const py = areaPoints[i+1];
        const rx = px * Math.cos(-angleRad) - py * Math.sin(-angleRad);
        const ry = px * Math.sin(-angleRad) + py * Math.cos(-angleRad);
        const mx = rx * scale;
        const my = (ry * scale) / cosTheta;
        
        coords.push({x: mx, y: my});
        if (mx < minX) minX = mx;
        if (mx > maxX) maxX = mx;
        if (my < minY) minY = my;
        if (my > maxY) maxY = my;
      }

      const normalizedCoords = coords.map(p => ({ x: p.x - minX, y: p.y - minY }));
      const wSpan = maxX - minX;
      const hSpan = maxY - minY;

      // ★修正：選択されたパネルの正確な寸法を取得して計算に使用
      const selectedPanel = PANEL_DATA[maker as keyof typeof PANEL_DATA].find(p => p.id === panelId) || PANEL_DATA["長州産業"][0];
      const panelW = selectedPanel.width; 
      const panelH = selectedPanel.height; 
      const marginM = panelMarginMm / 1000; 

      let bestLayout: {x: number, y: number}[] = [];
      let maxCount = -1;
      
      const steps = 4; 
      for(let oy = 0; oy < panelH; oy += panelH / steps) {
        for(let ox = 0; ox < panelW; ox += panelW / steps) {
           const currentLayout = [];
           for (let y = oy; y <= hSpan - panelH; y += panelH) {
             for (let x = ox; x <= wSpan - panelW; x += panelW) {
                if (validatePanel(x, y, panelW, panelH, marginM, normalizedCoords)) {
                  currentLayout.push({x, y});
                }
             }
           }
           if (currentLayout.length > maxCount) {
              maxCount = currentLayout.length;
              bestLayout = currentLayout;
           }
        }
      }
      setPreviewPanels(bestLayout);

      const realMetersToPx = (mx: number, my: number) => {
        const rx = mx / scale;
        const ry = (my * cosTheta) / scale;
        const px = rx * Math.cos(angleRad) - ry * Math.sin(angleRad);
        const py = rx * Math.sin(angleRad) + ry * Math.cos(angleRad);
        return [px, py];
      };

      const finalPanelsPx: Array<number[]> = [];
      bestLayout.forEach(panel => {
        const absX = panel.x + minX;
        const absY = panel.y + minY;
        const c1 = realMetersToPx(absX, absY);
        const c2 = realMetersToPx(absX + panelW, absY);
        const c3 = realMetersToPx(absX + panelW, absY + panelH);
        const c4 = realMetersToPx(absX, absY + panelH);
        finalPanelsPx.push([...c1, ...c2, ...c3, ...c4]);
      });
      setReadyPanelsPx(finalPanelsPx);

    } else {
      setPreviewPanels([]);
      setReadyPanelsPx([]);
    }
  }, [refLine, areaPoints, calibLength, roofPitch, maker, panelId, panelMarginMm]);

  const handlePointsConfirmed = (ref: number[], area: number[]) => {
    setRefLine(ref);
    setAreaPoints(area);
    setPlacedPanelsCoords([]);
    setResultCount(0);
    setResultCapacity("0.00");
    setAnnualGen(0); 
  };

  const handleSimulate = () => {
    if (refLine.length < 4 || areaPoints.length < 6 || previewPanels.length === 0) {
      alert("エリアが指定されていないか、パネルを配置できるスペースがありません。");
      return;
    }

    // ★修正：選択されたパネルの正確なワット数（kW）を取得して計算に使用
    const selectedPanel = PANEL_DATA[maker as keyof typeof PANEL_DATA].find(p => p.id === panelId) || PANEL_DATA["長州産業"][0];
    const panelKw = selectedPanel.kw; 
    const capacity = previewPanels.length * panelKw;
    
    setResultCount(previewPanels.length);
    setResultCapacity(capacity.toFixed(2));
    setPlacedPanelsCoords(readyPanelsPx);

    const mockNedoSolarRad = [2.5, 3.2, 3.8, 4.5, 4.8, 4.2, 4.5, 4.8, 3.7, 3.0, 2.6, 2.3];
    const lossFactor = 0.8; 
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let totalAnn = 0;
    const monthlyData = mockNedoSolarRad.map((rad, index) => {
      const gen = capacity * rad * lossFactor * azimuth * daysInMonth[index];
      totalAnn += gen;
      return Math.round(gen);
    });

    setMonthlyGen(monthlyData);
    setAnnualGen(Math.round(totalAnn));
  };

  return (
    <main className="flex h-screen w-full bg-gray-50 text-gray-800 font-sans">
      <section className="flex-grow p-6 flex flex-col">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Solar Sim Pro</h1>
        </header>
        <div className="flex-grow flex flex-col">
          <div className="border border-gray-300 rounded-md overflow-hidden bg-white shadow-sm flex-grow">
            <RoofCanvas 
              onPointsConfirmed={handlePointsConfirmed} 
              placedPanels={placedPanelsCoords}
            />
          </div>
        </div>
      </section>

      <aside className="w-[450px] bg-white border-l border-gray-200 shadow-sm p-6 flex flex-col overflow-y-auto">
        <h2 className="text-lg font-semibold mb-6 border-b pb-2">シミュレーション設定</h2>
        
        <div className="mb-4 p-4 bg-red-50 rounded-lg border border-red-100">
          <h3 className="text-sm font-bold text-red-800 mb-2">1. 基準線の実測長</h3>
          <div className="flex items-center space-x-2">
            <input 
              type="number" 
              value={calibLength}
              onChange={(e) => setCalibLength(Number(e.target.value))}
              className="border p-2 rounded-md w-full text-right"
            />
            <span className="text-sm text-gray-700">メートル</span>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-bold text-gray-700 mb-2">2. 屋根の傾斜 (寸勾配)</h3>
          <div className="flex items-center space-x-2">
            <input 
              type="number" 
              value={roofPitch}
              onChange={(e) => setRoofPitch(Number(e.target.value))}
              className="border p-2 rounded-md w-24 text-right"
              step={0.5}
              min={0}
            />
            <span className="text-sm text-gray-700">寸</span>
          </div>
        </div>

        {/* 2Dプレビューを削除し、代わりにパネル選択のUIを強化 */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 shadow-inner">
          <h3 className="text-sm font-bold text-gray-700 mb-3">3. パネル仕様</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">メーカー</label>
              <select 
                value={maker}
                onChange={(e) => setMaker(e.target.value)}
                className="border p-2 rounded-md w-full bg-white"
              >
                {Object.keys(PANEL_DATA).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">パネル型番 (寸法・出力)</label>
              <select 
                value={panelId}
                onChange={(e) => setPanelId(e.target.value)}
                className="border p-2 rounded-md w-full bg-white text-sm"
              >
                {PANEL_DATA[maker as keyof typeof PANEL_DATA].map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-bold text-gray-700 mb-2">4. 離隔幅設定</h3>
          <div className="flex items-center space-x-2">
            <input 
              type="number" 
              value={panelMarginMm}
              onChange={(e) => setPanelMarginMm(Number(e.target.value))}
              className="border p-2 rounded-md w-24 text-right"
              min={0}
              step={100}
            />
            <span className="text-sm text-gray-600">ミリメートル</span>
          </div>
        </div>

        <div className="mb-8 p-4 bg-green-50 rounded-lg border border-green-100">
          <h3 className="text-sm font-bold text-green-800 mb-3">5. 環境データ (NEDO連携用)</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">郵便番号 (日射量データ取得)</label>
              <input 
                type="text" 
                placeholder="例: 980-0003"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                className="border p-2 rounded-md w-full mb-1"
              />
              
              {locationInfo.address && (
                <div className="mt-2 p-2 bg-white rounded border border-green-200 text-xs text-gray-600 shadow-sm">
                  <div>📍 <strong>住所:</strong> {locationInfo.address}</div>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">屋根の方位</label>
              <select 
                value={azimuth}
                onChange={(e) => setAzimuth(Number(e.target.value))}
                className="border p-2 rounded-md w-full bg-white"
              >
                <option value={1.0}>南</option>
                <option value={0.95}>南東・南西</option>
                <option value={0.84}>東・西</option>
                <option value={0.71}>北東・北西</option>
                <option value={0.64}>北</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-gray-200">
          <button 
            onClick={handleSimulate}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-sm mb-6"
          >
            シミュレーション実行
          </button>
          
          <h3 className="text-sm font-bold text-gray-700 mb-4">シミュレーション結果</h3>
          
          <div className="bg-blue-50 p-4 rounded-lg text-center mb-4 border border-blue-100 shadow-inner">
            <p className="text-xs text-blue-600 font-semibold mb-1">想定最大システム容量</p>
            <p className="text-3xl font-bold text-blue-800">
              {resultCapacity} <span className="text-lg font-normal">kW</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">設置可能枚数: {resultCount} 枚</p>
          </div>

          {annualGen > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
              
              {locationInfo.station && (
                <div className="mb-3 p-2 bg-green-50 border border-green-100 rounded text-xs text-gray-600 flex items-center space-x-2">
                  <span>📡</span>
                  <span><strong>適用NEDO観測地点:</strong> <span className="text-green-700 font-bold">{locationInfo.station}</span></span>
                </div>
              )}

              <div className="flex justify-between items-end mb-4 border-b border-gray-200 pb-2">
                <p className="text-sm font-bold text-gray-700">月別予測発電量</p>
                <p className="text-xs text-gray-500">年間: <span className="font-bold text-blue-600 text-base">{annualGen.toLocaleString()}</span> kWh</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <table className="w-full text-xs">
                  <tbody>
                    {monthlyGen.slice(0, 6).map((val, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="py-1.5 text-gray-500">{i + 1}月</td>
                        <td className="py-1.5 text-right font-medium text-gray-800">{val.toLocaleString()} kWh</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="w-full text-xs">
                  <tbody>
                    {monthlyGen.slice(6, 12).map((val, i) => (
                      <tr key={i + 6} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="py-1.5 text-gray-500">{i + 7}月</td>
                        <td className="py-1.5 text-right font-medium text-gray-800">{val.toLocaleString()} kWh</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}
// === ⬇️ コピーはここまで ⬇️ ===