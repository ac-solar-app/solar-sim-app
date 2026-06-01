"use client";

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
// ★データベースとの通信パイプ
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

export default function Home() {
  const [refLine, setRefLine] = useState<number[]>([]);
  const [areaPoints, setAreaPoints] = useState<number[]>([]);
  
  const [calibLength, setCalibLength] = useState<number>(10);
  const [roofPitch, setRoofPitch] = useState<number>(5.5); 
  const [panelMarginMm, setPanelMarginMm] = useState<number>(500); 

  // ★パネル情報用
  const [panelData, setPanelData] = useState<Record<string, any[]>>({});
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);

  const [maker, setMaker] = useState<string>("");
  const [panelId, setPanelId] = useState<string>("");
  
  // ➕【追加】全国150拠点のNEDO日射量データを保存する箱
  const [solarDataList, setSolarDataList] = useState<any[]>([]);
  const [zipCode, setZipCode] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [matchedStation, setMatchedStation] = useState<any>(null);

  const [azimuth, setAzimuth] = useState<number>(1.0); 
  
  const [resultCount, setResultCount] = useState<number>(0);
  const [resultCapacity, setResultCapacity] = useState<string>("0.00");
  const [placedPanelsCoords, setPlacedPanelsCoords] = useState<Array<number[]>>([]);
  
  const [monthlyGen, setMonthlyGen] = useState<number[]>(Array(12).fill(0));
  const [annualGen, setAnnualGen] = useState<number>(0);

  const [previewPanels, setPreviewPanels] = useState<{x: number, y: number}[]>([]);
  const [readyPanelsPx, setReadyPanelsPx] = useState<Array<number[]>>([]);
  const [simulateTrigger, setSimulateTrigger] = useState<number>(0);

  // ★画面が開いた瞬間にSupabaseからデータをまとめて取得する処理（パネルデータ＆150拠点日射量データ）
  useEffect(() => {
    const fetchInitialMasterData = async () => {
      try {
        // ① パネルデータの取得
        const { data: pData, error: pError } = await supabase.from('panels').select('*');
        if (pError) throw pError;

        if (pData && pData.length > 0) {
          const bundled: Record<string, any[]> = {};
          pData.forEach(p => {
            if (!bundled[p.maker]) bundled[p.maker] = [];
            bundled[p.maker].push(p);
          });
          setPanelData(bundled);
          
          const firstMaker = Object.keys(bundled)[0];
          setMaker(firstMaker);
          setPanelId(bundled[firstMaker][0].id);
        }

        // ➕【追加】② 全国150拠点のNEDO気象データの取得
        const { data: sData, error: sError } = await supabase.from('solar_data').select('*');
        if (sError) throw sError;
        if (sData) {
          setSolarDataList(sData);
        }

      } catch (error) {
        console.error("データベース初期読み込みエラー:", error);
      } finally {
        setIsLoadingDb(false);
      }
    };

    fetchInitialMasterData();
  }, []);

  // ★メーカー変更時の型番自動選択処理
  useEffect(() => {
    if (!isLoadingDb && maker && panelData[maker]) {
      setPanelId(panelData[maker][0].id);
    }
  }, [maker, isLoadingDb, panelData]);

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

  // ➕【追加】住所テキスト（手入力、または郵便番号から自動生成された住所）から最適なNEDO都市を150拠点から特定する
  const findBestSolarStation = (addressText: string) => {
    if (!addressText || solarDataList.length === 0) return null;

    // まず都道府県名が一致する拠点（数拠点）に絞り込む
    const prefGroup = solarDataList.filter(row => addressText.includes(row.pref));
    if (prefGroup.length === 0) return null;

    // その都道府県の拠点の中で、都市名（station）が住所テキストの中に含まれているか判定（例：「会津若松市」なら「若松」が一致）
    const exactMatch = prefGroup.find(row => addressText.includes(row.station));
    
    // 都市名レベルで部分一致がなければ、その都道府県の1番目の都市（代表拠点）をデフォルトとして適用
    return exactMatch || prefGroup[0];
  };

  // ➕【追加】郵便番号入力時の自動処理（無料の外部住所検索APIを叩く）
  const handleZipCodeChange = async (val: string) => {
    setZipCode(val);
    const cleanZip = val.replace("-", "").trim();
    
    if (cleanZip.length === 7) {
      try {
        const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleanZip}`);
        const json = await res.json();
        if (json.results && json.results.length > 0) {
          const resObj = json.results[0];
          const fullAddress = resObj.address1 + resObj.address2 + resObj.address3;
          setAddress(fullAddress); // 住所入力欄にも自動セット
          
          // 即座に日射量観測所を特定してセット
          const bestStation = findBestSolarStation(fullAddress);
          setMatchedStation(bestStation);
        }
      } catch (e) {
        console.error("郵便番号からの住所検索に失敗しました:", e);
      }
    }
  };

  // ➕【追加】住所を手動で書き換えたときの処理
  const handleAddressChange = (val: string) => {
    setAddress(val);
    const bestStation = findBestSolarStation(val);
    setMatchedStation(bestStation);
  };

  useEffect(() => {
    if (isLoadingDb || !maker || !panelData[maker]) return;

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

      const makerPanels = panelData[maker] || [];
      const selectedPanel = makerPanels.find(p => p.id === panelId) || makerPanels[0];
      if (!selectedPanel) return;

      const panelW = Number(selectedPanel.width); 
      const panelH = Number(selectedPanel.height); 
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
  }, [refLine, areaPoints, calibLength, roofPitch, maker, panelId, panelMarginMm, panelData, isLoadingDb]);

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

    const makerPanels = panelData[maker] || [];
    const selectedPanel = makerPanels.find(p => p.id === panelId) || makerPanels[0];
    if (!selectedPanel) return;

    const panelKw = Number(selectedPanel.kw); 
    const capacity = previewPanels.length * panelKw;
    
    setResultCount(previewPanels.length);
    setResultCapacity(capacity.toFixed(2));
    setPlacedPanelsCoords(readyPanelsPx);

    // ★変更：ダミー配列をやめて、特定された150拠点のリアルなNEDO日射量データをセットする
    // 万が一拠点が特定されていない場合は、安全のために標準的なダミー値をフォールバックにします
    const targetRadiation = matchedStation ? [
      Number(matchedStation.m1), Number(matchedStation.m2), Number(matchedStation.m3), Number(matchedStation.m4),
      Number(matchedStation.m5), Number(matchedStation.m6), Number(matchedStation.m7), Number(matchedStation.m8),
      Number(matchedStation.m9), Number(matchedStation.m10), Number(matchedStation.m11), Number(matchedStation.m12)
    ] : [2.5, 3.2, 3.8, 4.5, 4.8, 4.2, 4.5, 4.8, 3.7, 3.0, 2.6, 2.3];

    const lossFactor = 0.8; 
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let totalAnn = 0;
    const monthlyData = targetRadiation.map((rad, index) => {
      const gen = capacity * rad * lossFactor * azimuth * daysInMonth[index];
      totalAnn += gen;
      return Math.round(gen);
    });

    setMonthlyGen(monthlyData);
    setAnnualGen(Math.round(totalAnn));

    setSimulateTrigger(prev => prev + 1);
  };

  return (
    <main className="flex h-[100dvh] w-full bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      <section className="flex-grow p-4 flex flex-col overflow-hidden h-full">
        <header className="mb-2 flex-none">
          <h1 className="text-xl font-bold text-gray-900">Solar Sim Pro</h1>
        </header>
        <div className="flex-grow border border-gray-300 rounded-md bg-white shadow-sm overflow-hidden relative min-h-0">
          <RoofCanvas 
            onPointsConfirmed={handlePointsConfirmed} 
            placedPanels={placedPanelsCoords}
            simulateTrigger={simulateTrigger} 
          />
        </div>
      </section>

      <aside className="w-[450px] bg-white border-l border-gray-200 shadow-sm p-5 flex flex-col overflow-y-auto h-full flex-none">
        <h2 className="text-base font-semibold mb-4 border-b pb-1">シミュレーション設定</h2>
        
        <div className="space-y-4">
          
          <div className="p-3 bg-red-50 rounded-lg border border-red-100">
            <h3 className="text-xs font-bold text-red-800 mb-2">1. 基準線の実測長</h3>
            <div className="flex items-center space-x-2">
              <input 
                type="number" 
                value={calibLength}
                onChange={(e) => setCalibLength(Number(e.target.value))}
                className="border p-2 rounded-md w-full text-right bg-white text-sm font-medium"
              />
              <span className="text-xs text-gray-700 w-16">メートル</span>
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 shadow-inner">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-bold text-gray-700">2. 屋根傾斜 & パネル仕様</h3>
              <div className="flex items-center space-x-1">
                <span className="text-xs text-gray-600">傾斜:</span>
                <input 
                  type="number" 
                  value={roofPitch}
                  onChange={(e) => setRoofPitch(Number(e.target.value))}
                  className="border p-1 rounded w-14 text-right text-xs bg-white font-medium"
                  step={0.5}
                  min={0}
                />
                <span className="text-xs text-gray-700">寸</span>
              </div>
            </div>

            {isLoadingDb ? (
              <div className="flex justify-center items-center py-6 text-xs text-blue-600 font-bold animate-pulse">
                ☁️ クラウドからパネルデータを読み込み中...
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">メーカー</label>
                  <select 
                    value={maker}
                    onChange={(e) => setMaker(e.target.value)}
                    className="border p-2 rounded-md w-full bg-white text-xs font-medium"
                  >
                    {Object.keys(panelData).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block mb-0.5">型番 (寸法・出力)</label>
                  <select 
                    value={panelId}
                    onChange={(e) => setPanelId(e.target.value)}
                    className="border p-2 rounded-md w-full bg-white text-xs font-medium"
                  >
                    {panelData[maker]?.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                  <span className="text-xs text-gray-600 font-bold">離隔幅 (屋根端からの隙間):</span>
                  <div className="flex items-center space-x-1">
                    <input 
                      type="number" 
                      value={panelMarginMm}
                      onChange={(e) => setPanelMarginMm(Number(e.target.value))}
                      className="border p-1 rounded w-20 text-right text-xs bg-white font-medium"
                      min={0}
                      step={100}
                    />
                    <span className="text-xs text-gray-600">mm</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ★変更：ダブル入力対応のインテリジェンス地域入力エリア */}
          <div className="p-3 bg-green-50 rounded-lg border border-green-100">
            <h3 className="text-xs font-bold text-green-800 mb-2">3. 環境データ (NEDO日射量自動連動)</h3>
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="text-[10px] text-gray-500 block mb-0.5">郵便番号</label>
                  <input 
                    type="text" 
                    placeholder="981-0000"
                    value={zipCode}
                    onChange={(e) => handleZipCodeChange(e.target.value)}
                    className="border p-2 rounded-md w-full text-xs bg-white font-medium"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-gray-500 block mb-0.5">住所（手入力・自動検索共通）</label>
                  <input 
                    type="text" 
                    placeholder="例: 宮城県白石市 / 福島県会津若松市"
                    value={address}
                    onChange={(e) => handleAddressChange(e.target.value)}
                    className="border p-2 rounded-md w-full text-xs bg-white font-medium"
                  />
                </div>
              </div>

              {/* ➕【追加】現在、150拠点のうちどれが判定されて適用されているかをリアルタイムバッジ表示 */}
              {matchedStation ? (
                <div className="text-[10px] text-green-700 bg-white p-2 rounded border border-green-200 shadow-sm font-semibold">
                  ☀️ NEDO気象台自動連動：<span className="text-blue-700 font-bold">【{matchedStation.pref} / {matchedStation.station}】</span>のリアルな気象データを計算に適用しています！
                </div>
              ) : (
                <div className="text-[10px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 shadow-sm">
                  💡 郵便番号(7桁)を入力するか、住所を入力すると自動で最も近いNEDOの観測拠点を特定します。
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-gray-600 font-bold">屋根の方位:</span>
                <select 
                  value={azimuth}
                  onChange={(e) => setAzimuth(Number(e.target.value))}
                  className="border p-1.5 rounded-md w-28 bg-white text-xs font-medium"
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

        </div>

        <div className="mt-6 border-t border-gray-200 pt-4 flex-grow flex flex-col justify-end">
          <button 
            onClick={handleSimulate}
            disabled={isLoadingDb}
            className={`w-full text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-md text-sm mb-4 ${isLoadingDb ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            シミュレーション実行
          </button>
          
          {resultCount > 0 && (
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 shadow-inner text-center">
                <p className="text-[11px] text-blue-600 font-bold mb-0.5">想定最大システム容量</p>
                <p className="text-3xl font-extrabold text-blue-800">
                  {resultCapacity} <span className="text-lg font-normal">kW</span>
                </p>
                <p className="text-xs text-gray-600 font-medium mt-0.5">設置枚数: {resultCount} 枚</p>
              </div>

              {annualGen > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm text-xs">
                  {matchedStation && (
                    <div className="mb-2 p-1.5 bg-green-50 border border-green-100 rounded text-[10px] text-gray-600 font-medium">
                      📡 <strong>適用中のデータソース:</strong> NEDO気象台（{matchedStation.pref} - {matchedStation.station}）
                    </div>
                  )}
                  <div className="flex justify-between items-end mb-2 border-b pb-1">
                    <p className="font-bold text-gray-700">月別予測発電量</p>
                    <p className="text-[10px] text-gray-500">年間: <span className="font-bold text-blue-600 text-sm">{annualGen.toLocaleString()}</span> kWh</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="space-y-1">
                      {monthlyGen.slice(0, 6).map((val, i) => (
                        <div key={i} className="flex justify-between border-b border-gray-50 py-0.5">
                          <span className="text-gray-400">{i + 1}月</span>
                          <span className="font-bold text-gray-700">{val.toLocaleString()} kWh</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {monthlyGen.slice(6, 12).map((val, i) => (
                        <div key={i + 6} className="flex justify-between border-b border-gray-50 py-0.5">
                          <span className="text-gray-400">{i + 7}月</span>
                          <span className="font-bold text-gray-700">{val.toLocaleString()} kWh</span>
                        </div>
                      ))}
                    </div>
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