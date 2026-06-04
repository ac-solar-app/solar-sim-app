"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase'; 

const RoofCanvas = dynamic(() => import('@/components/RoofCanvas'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-gray-100 animate-pulse">Loading Canvas...</div>
});

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

const validatePanel = (px: number, py: number, pW: number, pH: number, margin: number, poly: {x: number, y: number}[]) => {
  const corners = [ {x: px, y: py}, {x: px + pW, y: py}, {x: px + pW, y: py + pH}, {x: px, y: py + pH} ];
  for (const c of corners) {
    if (!isInsidePolygon(c.x, c.y, poly)) return false;
  }
  for (let i = 0; i < 4; i++) {
    const p1 = corners[i]; const p2 = corners[(i + 1) % 4];
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
      const q1 = poly[k]; const q2 = poly[j];
      if (doSegmentsIntersect(p1, p2, q1, q2)) return false;
    }
  }
  if (margin > 0) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j].x, ay = poly[j].y; const bx = poly[i].x, by = poly[i].y;
      for (const c of corners) { if (pointToSegmentDist(c.x, c.y, ax, ay, bx, by) < margin) return false; }
      const cx = Math.max(Math.min(ax, px + pW), px); const cy = Math.max(Math.min(ay, py + pH), py);
      const distToRect = Math.hypot(ax - cx, ay - cy);
      if (distToRect < margin) return false;
    }
  }
  return true;
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// 方位から面のおすすめネーミングを取得
const getAzimuthName = (val: number) => {
  if (val === 1.0) return "南面";
  if (val === 0.95) return "南東/南西面";
  if (val === 0.84) return "東/西面";
  if (val === 0.71) return "北東/北西面";
  if (val === 0.64) return "北面";
  return "屋根面";
};

// 屋根面データ専用の型
type RoofFace = {
  id: string;
  pitch: number;
  azimuth: number;
  areaPoints: number[];
  placedPanelsCoords: number[][];
  activePanels: boolean[];
  capacity: number;
  count: number;
  annualGen: number;
  monthlyGen: number[];
};

export default function Home() {
  // --- Global Settings ---
  const [refLine, setRefLine] = useState<number[]>([]);
  const [calibLength, setCalibLength] = useState<number>(10);
  const [panelMarginMm, setPanelMarginMm] = useState<number>(500); 
  const [electricityRate, setElectricityRate] = useState<number>(35);

  const [panelData, setPanelData] = useState<Record<string, any[]>>({});
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);
  const [maker, setMaker] = useState<string>("");
  const [panelId, setPanelId] = useState<string>("");
  
  const [solarDataList, setSolarDataList] = useState<any[]>([]);
  const [zipCode, setZipCode] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [matchedStation, setMatchedStation] = useState<any>(null);
  const [isSearchingGPS, setIsSearchingGPS] = useState<boolean>(false);

  // --- Multi-Face Architecture ---
  const [faces, setFaces] = useState<RoofFace[]>([]);
  const [addAreaTrigger, setAddAreaTrigger] = useState<number>(0);
  const [simulateTrigger, setSimulateTrigger] = useState<number>(0);

  useEffect(() => {
    const fetchInitialMasterData = async () => {
      try {
        const { data: pData, error: pError } = await supabase.from('panels').select('*').order('kw', { ascending: false });
        if (pError) throw pError;
        if (pData && pData.length > 0) {
          const bundled: Record<string, any[]> = {};
          pData.forEach(p => { if (!bundled[p.maker]) bundled[p.maker] = []; bundled[p.maker].push(p); });
          setPanelData(bundled); setMaker(Object.keys(bundled)[0]); setPanelId(bundled[Object.keys(bundled)[0]][0].id);
        }
        const { data: sData, error: sError } = await supabase.from('solar_data').select('*');
        if (sError) throw sError;
        if (sData) setSolarDataList(sData);
      } catch (error) { console.error("DB読み込みエラー:", error); } finally { setIsLoadingDb(false); }
    };
    fetchInitialMasterData();
  }, []);

  const executeGPSMatch = async (addressText: string) => {
    if (!addressText || solarDataList.length === 0) return;
    setIsSearchingGPS(true);
    try {
      const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(addressText)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lon = data[0].geometry.coordinates[0]; const lat = data[0].geometry.coordinates[1];
        let closest = solarDataList[0]; let minDistance = Infinity;
        for (const st of solarDataList) {
          if (st.lat && st.lon) {
            const dist = calculateDistance(lat, lon, Number(st.lat), Number(st.lon));
            if (dist < minDistance) { minDistance = dist; closest = st; }
          }
        }
        setMatchedStation(closest);
      } else {
        setMatchedStation(solarDataList.find(row => addressText.includes(row.pref) && addressText.includes(row.station)) || solarDataList[0]);
      }
    } catch (e) {
      setMatchedStation(solarDataList[0]);
    } finally {
      setIsSearchingGPS(false);
    }
  };

  const handleZipCodeChange = async (val: string) => {
    setZipCode(val);
    const cleanZip = val.replace("-", "").trim();
    if (cleanZip.length === 7) {
      try {
        const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleanZip}`);
        const json = await res.json();
        if (json.results && json.results.length > 0) {
          const fullAddress = json.results[0].address1 + json.results[0].address2 + json.results[0].address3;
          setAddress(fullAddress); await executeGPSMatch(fullAddress);
        }
      } catch (e) { console.error(e); }
    }
  };

  // 発電量の計算エンジン
  const calcGen = (activeCount: number, capacity: number, az: number) => {
    if (activeCount === 0) return { annualGen: 0, monthlyGen: Array(12).fill(0) };
    const targetRadiation = matchedStation ? [
      Number(matchedStation.m1), Number(matchedStation.m2), Number(matchedStation.m3), Number(matchedStation.m4),
      Number(matchedStation.m5), Number(matchedStation.m6), Number(matchedStation.m7), Number(matchedStation.m8),
      Number(matchedStation.m9), Number(matchedStation.m10), Number(matchedStation.m11), Number(matchedStation.m12)
    ] : [2.5, 3.2, 3.8, 4.5, 4.8, 4.2, 4.5, 4.8, 3.7, 3.0, 2.6, 2.3];

    const lossFactor = 0.8; 
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let totalAnn = 0;
    const monthlyData = targetRadiation.map((rad, index) => {
      const gen = capacity * rad * lossFactor * az * daysInMonth[index];
      totalAnn += gen;
      return Math.round(gen);
    });
    return { annualGen: Math.round(totalAnn), monthlyGen: monthlyData };
  };

  // キャンバスでエリア指定が確定した時、面を追加
  const handlePointsConfirmed = (ref: number[], area: number[]) => {
    if (ref.length === 4) setRefLine(ref);
    if (area.length >= 6) {
      const newFace: RoofFace = {
        id: `face-${Date.now()}`,
        pitch: 5.5,
        azimuth: 1.0,
        areaPoints: area,
        placedPanelsCoords: [],
        activePanels: [],
        capacity: 0, count: 0, annualGen: 0, monthlyGen: Array(12).fill(0)
      };
      setFaces(prev => {
        if(prev.length === 0) return [newFace]; // 初回
        return [...prev, newFace];
      });
    } else if (ref.length === 0 && area.length === 0) {
      setFaces([]); // やり直し
    }
  };

  const updateFace = (id: string, field: keyof RoofFace, value: any) => {
    setFaces(prev => prev.map(f => f.id === id ? { ...f, [field]: value } : f));
  };

  const deleteFace = (id: string) => {
    setFaces(prev => prev.filter(f => f.id !== id));
  };

  const handleSimulate = () => {
    if (refLine.length < 4 || faces.length === 0) {
      alert("基準線と、最低1つ以上のエリアを指定してください。");
      return;
    }

    const makerPanels = panelData[maker] || [];
    const selectedPanel = makerPanels.find(p => p.id === panelId) || makerPanels[0];
    if (!selectedPanel) return;

    const panelW = Number(selectedPanel.width); 
    const panelH = Number(selectedPanel.height); 
    const panelKw = Number(selectedPanel.kw);
    const marginM = panelMarginMm / 1000; 

    const dx = refLine[2] - refLine[0];
    const dy = refLine[3] - refLine[1];
    const refPxLength = Math.hypot(dx, dy);
    if (refPxLength === 0) return;
    
    const scale = calibLength / refPxLength; 
    const angleRad = Math.atan2(dy, dx);

    const updatedFaces = faces.map(face => {
      const cosTheta = 10 / Math.sqrt(100 + Math.pow(face.pitch, 2));

      // エリアのローカル座標化とバウンディングボックス
      const coords = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < face.areaPoints.length; i += 2) {
        const px = face.areaPoints[i]; const py = face.areaPoints[i+1];
        const rx = px * Math.cos(-angleRad) - py * Math.sin(-angleRad);
        const ry = px * Math.sin(-angleRad) + py * Math.cos(-angleRad);
        const mx = rx * scale; const my = (ry * scale) / cosTheta;
        coords.push({x: mx, y: my});
        if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
        if (my < minY) minY = my; if (my > maxY) maxY = my;
      }
      const normalizedCoords = coords.map(p => ({ x: p.x - minX, y: p.y - minY }));
      const wSpan = maxX - minX; const hSpan = maxY - minY;

      // レイアウト探索
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
              maxCount = currentLayout.length; bestLayout = currentLayout;
           }
        }
      }

      // ピクセル座標に戻す
      const realMetersToPx = (mx: number, my: number) => {
        const rx = mx / scale; const ry = (my * cosTheta) / scale;
        const px = rx * Math.cos(angleRad) - ry * Math.sin(angleRad);
        const py = rx * Math.sin(angleRad) + ry * Math.cos(angleRad);
        return [px, py];
      };

      const finalPanelsPx: Array<number[]> = [];
      bestLayout.forEach(panel => {
        const absX = panel.x + minX; const absY = panel.y + minY;
        const c1 = realMetersToPx(absX, absY); const c2 = realMetersToPx(absX + panelW, absY);
        const c3 = realMetersToPx(absX + panelW, absY + panelH); const c4 = realMetersToPx(absX, absY + panelH);
        finalPanelsPx.push([...c1, ...c2, ...c3, ...c4]);
      });

      // ON/OFF状態の維持（前回と枚数が同じなら記憶を引き継ぐ）
      const activePanels = finalPanelsPx.length === face.activePanels.length ? face.activePanels : new Array(finalPanelsPx.length).fill(true);
      const activeCount = activePanels.filter(v => v).length; 
      const capacity = activeCount * panelKw;
      const gen = calcGen(activeCount, capacity, face.azimuth);

      return {
        ...face,
        placedPanelsCoords: finalPanelsPx,
        activePanels,
        count: activeCount,
        capacity,
        annualGen: gen.annualGen,
        monthlyGen: gen.monthlyGen
      };
    });

    setFaces(updatedFaces);
    setSimulateTrigger(prev => prev + 1);
  };

  const handleTogglePanel = (faceIndex: number, panelIndex: number) => {
    setFaces(prev => {
      const newFaces = [...prev];
      const face = {...newFaces[faceIndex]};
      const newActive = [...face.activePanels];
      newActive[panelIndex] = !newActive[panelIndex];
      face.activePanels = newActive;

      const makerPanels = panelData[maker] || [];
      const selectedPanel = makerPanels.find(p => p.id === panelId) || makerPanels[0];
      const panelKw = selectedPanel ? Number(selectedPanel.kw) : 0;

      const activeCount = newActive.filter(v => v).length;
      const capacity = activeCount * panelKw;
      const gen = calcGen(activeCount, capacity, face.azimuth);

      face.count = activeCount;
      face.capacity = capacity;
      face.annualGen = gen.annualGen;
      face.monthlyGen = gen.monthlyGen;

      newFaces[faceIndex] = face;
      return newFaces;
    });
  };

  // 複数面の合算
  const totalCount = faces.reduce((sum, f) => sum + f.count, 0);
  const totalCapacity = faces.reduce((sum, f) => sum + f.capacity, 0);
  const totalAnnualGen = faces.reduce((sum, f) => sum + f.annualGen, 0);
  const totalMonthlyGen = Array(12).fill(0);
  faces.forEach(f => {
    f.monthlyGen.forEach((val, i) => { totalMonthlyGen[i] += val; });
  });

  return (
    <main className="flex h-[100dvh] w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      <section className="flex-grow p-4 flex flex-col overflow-hidden h-full">
        <header className="mb-2 flex-none">
          <h1 className="text-xl font-bold text-gray-900">Solar Sim Pro <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded ml-2">複数屋根合算対応</span></h1>
        </header>
        <div className="flex-grow border border-gray-300 rounded-md bg-white shadow-sm overflow-hidden relative min-h-0">
          <RoofCanvas 
            onPointsConfirmed={handlePointsConfirmed} 
            savedFaces={faces}
            simulateTrigger={simulateTrigger} 
            calibLength={calibLength}
            onTogglePanel={handleTogglePanel}
            addAreaTrigger={addAreaTrigger}
          />
        </div>
      </section>

      <aside className="w-[450px] bg-white border-l border-gray-200 shadow-sm p-4 flex flex-col overflow-y-auto h-full flex-none">
        
        {/* === 共通設定エリア === */}
        <h2 className="text-sm font-semibold mb-3 border-b pb-1 text-gray-700">【共通】環境＆パネル設定</h2>
        <div className="space-y-3 mb-6">
          <div className="p-2 bg-red-50 rounded border border-red-100 flex items-center justify-between">
            <span className="text-xs font-bold text-red-800">基準線の実測長:</span>
            <div className="flex items-center space-x-1">
              <input type="number" value={calibLength} onChange={(e) => setCalibLength(Number(e.target.value))} className="border p-1 rounded w-16 text-right text-xs bg-white" />
              <span className="text-xs text-gray-700">m</span>
            </div>
          </div>

          <div className="p-2 bg-gray-50 rounded border border-gray-200">
            {isLoadingDb ? ( <div className="text-xs text-center text-blue-500 animate-pulse">DB読込中...</div> ) : (
              <div className="space-y-2">
                <select value={maker} onChange={(e) => setMaker(e.target.value)} className="border p-1.5 rounded w-full text-xs">
                  {Object.keys(panelData).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={panelId} onChange={(e) => setPanelId(e.target.value)} className="border p-1.5 rounded w-full text-xs">
                  {panelData[maker]?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-600">離隔幅:</span>
                  <div><input type="number" value={panelMarginMm} onChange={(e) => setPanelMarginMm(Number(e.target.value))} className="border p-1 rounded w-16 text-right" step={100} /> mm</div>
                </div>
              </div>
            )}
          </div>

          <div className="p-2 bg-green-50 rounded border border-green-100">
            <div className="flex gap-2 mb-2">
              <input type="text" placeholder="〒" value={zipCode} onChange={(e) => handleZipCodeChange(e.target.value)} className="border p-1.5 rounded w-20 text-xs" />
              <input type="text" placeholder="住所検索" value={address} onChange={(e) => setAddress(e.target.value)} onBlur={() => executeGPSMatch(address)} className="border p-1.5 rounded flex-grow text-xs" />
            </div>
            {matchedStation && <div className="text-[10px] text-green-700 font-bold">🎯 NEDO: {matchedStation.pref} / {matchedStation.station} 適用中</div>}
          </div>
        </div>

        {/* === 個別設定（複数面）エリア === */}
        <h2 className="text-sm font-semibold mb-3 border-b pb-1 text-gray-700 flex justify-between items-end">
          <span>【個別】屋根面ごとの設定</span>
        </h2>
        
        <div className="space-y-3 flex-grow">
          {faces.length === 0 ? (
            <div className="text-xs text-center text-gray-400 py-4 border border-dashed rounded">エリアを指定してください</div>
          ) : (
            faces.map((face, i) => (
              <div key={face.id} className={`p-3 rounded-lg border ${face.count > 0 ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 shadow-sm'}`}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-sm text-blue-900">{getAzimuthName(face.azimuth)} <span className="text-xs font-normal text-gray-500">(エリア{i+1})</span></span>
                  <button onClick={() => deleteFace(face.id)} className="text-[10px] text-red-500 hover:text-red-700 px-2 py-1 border border-red-200 rounded bg-white">削除</button>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">屋根の方位</label>
                    <select value={face.azimuth} onChange={(e) => updateFace(face.id, 'azimuth', Number(e.target.value))} className="border p-1.5 rounded w-full text-xs">
                      <option value={1.0}>南</option><option value={0.95}>南東・南西</option><option value={0.84}>東・西</option><option value={0.71}>北東・北西</option><option value={0.64}>北</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">傾斜(寸)</label>
                    <input type="number" value={face.pitch} onChange={(e) => updateFace(face.id, 'pitch', Number(e.target.value))} className="border p-1.5 rounded w-full text-xs text-right" step={0.5} min={0} />
                  </div>
                </div>

                {face.count > 0 && (
                   <div className="text-right text-xs font-bold text-blue-700 border-t border-blue-100 pt-1 mt-1">
                     {face.count} 枚 / {face.capacity.toFixed(2)} kW
                   </div>
                )}
              </div>
            ))
          )}

          {faces.length > 0 && (
            <button 
              onClick={() => setAddAreaTrigger(prev => prev + 1)} 
              className="w-full py-2 border-2 border-dashed border-blue-300 text-blue-600 font-bold rounded-lg text-xs hover:bg-blue-50 transition-colors"
            >
              ＋ 新しい屋根面を追加する
            </button>
          )}
        </div>

        {/* === 合算結果エリア === */}
        <div className="mt-4 border-t border-gray-200 pt-4 flex flex-col flex-none">
          <button onClick={handleSimulate} disabled={isLoadingDb || faces.length === 0} className={`w-full text-white font-bold py-3 px-4 rounded-lg shadow-md text-sm mb-4 ${isLoadingDb || faces.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
            全エリア一括シミュレーション
          </button>
          
          {totalCount > 0 && (
            <div className="space-y-3">
              <div className="bg-blue-600 p-3 rounded-lg shadow-inner text-center text-white">
                <p className="text-[10px] font-bold opacity-80 mb-0.5">システム総合計 ({faces.length}面)</p>
                <p className="text-2xl font-extrabold">{totalCapacity.toFixed(2)} <span className="text-sm font-normal">kW</span></p>
                <p className="text-xs font-medium mt-0.5 opacity-90">総設置枚数: {totalCount} 枚</p>
              </div>

              {totalAnnualGen > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm text-xs">
                  <div className="flex justify-between items-end mb-1 border-b pb-1">
                    <p className="font-bold text-gray-700">合算予測発電量</p>
                    <p className="text-[10px] text-gray-500">年間: <span className="font-bold text-blue-600 text-sm">{totalAnnualGen.toLocaleString()}</span> kWh</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
                    <div className="space-y-0.5">
                      {totalMonthlyGen.slice(0, 6).map((val, i) => (<div key={i} className="flex justify-between border-b border-gray-50"><span className="text-gray-400">{i + 1}月</span><span className="font-bold">{val.toLocaleString()}</span></div>))}
                    </div>
                    <div className="space-y-0.5">
                      {totalMonthlyGen.slice(6, 12).map((val, i) => (<div key={i+6} className="flex justify-between border-b border-gray-50"><span className="text-gray-400">{i + 7}月</span><span className="font-bold">{val.toLocaleString()}</span></div>))}
                    </div>
                  </div>
                </div>
              )}

              {totalAnnualGen > 0 && (
                <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-2 shadow-md flex justify-between items-center">
                  <span className="text-[10px] text-yellow-800 font-bold ml-2">想定電気代単価: <input type="number" value={electricityRate} onChange={(e) => setElectricityRate(Number(e.target.value))} className="border border-yellow-300 rounded w-12 text-right p-0.5 bg-white" /> 円</span>
                  <div className="text-right mr-2">
                    <p className="text-[10px] text-yellow-800 font-bold mb-0.5">年間想定削減額</p>
                    <p className="text-lg font-extrabold text-yellow-900">{Math.round(totalAnnualGen * electricityRate).toLocaleString()} <span className="text-[10px] font-normal">円/年</span></p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </main>
  );
}