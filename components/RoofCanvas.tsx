"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from 'react-konva';
import useImage from 'use-image';

interface RoofFaceData {
  areaPoints: number[];
  placedPanelsCoords: number[][];
  activePanels: boolean[];
}

interface RoofCanvasProps {
  onPointsConfirmed: (refLine: number[], areaPoints: number[]) => void;
  savedFaces: RoofFaceData[];
  simulateTrigger?: number; 
  calibLength?: number; 
  onTogglePanel?: (faceIndex: number, panelIndex: number) => void;
  addAreaTrigger?: number;
}

export default function RoofCanvas({ onPointsConfirmed, savedFaces, simulateTrigger, calibLength = 10, onTogglePanel, addAreaTrigger }: RoofCanvasProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [image] = useImage(imageUrl || '');
  
  const [step, setStep] = useState<'upload' | 'reference' | 'area' | 'done'>('upload');
  const [refPoints, setRefPoints] = useState<number[]>([]);
  const [areaPoints, setAreaPoints] = useState<number[]>([]);

  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addAreaTrigger && addAreaTrigger > 0) {
      setStep('area');
      setAreaPoints([]);
    }
  }, [addAreaTrigger]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [imageUrl]);

  const fitImageToStage = useCallback(() => {
    if (image && containerRef.current) {
      const containerWidth = containerRef.current.offsetWidth;
      const containerHeight = containerRef.current.offsetHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      const scaleX = containerWidth / image.width;
      const scaleY = containerHeight / image.height;
      const newScale = Math.min(scaleX, scaleY); 

      const finalX = (containerWidth - image.width * newScale) / 2;
      const finalY = (containerHeight - image.height * newScale) / 2;

      setStageScale(newScale);
      setStagePos({ x: finalX, y: finalY });
    }
  }, [image]);

  useEffect(() => { fitImageToStage(); }, [fitImageToStage, dimensions]);
  useEffect(() => { if (simulateTrigger && simulateTrigger > 0) fitImageToStage(); }, [simulateTrigger, fitImageToStage]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImageUrl(event.target.result as string);
          setStep('reference'); 
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStageClick = (e: any) => {
    if (e.target.className === 'Circle' || e.target.parent?.className === 'Transformer') return;
    
    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const x = (pointerPos.x - stage.x()) / stage.scaleX();
    const y = (pointerPos.y - stage.y()) / stage.scaleY();

    if (step === 'reference') {
      if (refPoints.length < 4) setRefPoints([...refPoints, x, y]);
    } else if (step === 'area') {
      setAreaPoints([...areaPoints, x, y]);
    }
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.1; 
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const newScale = Math.max(0.1, Math.min(e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy, 10));

    setStageScale(newScale);
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  };

  const handleZoom = (direction: 1 | -1) => {
    const scaleBy = 1.2;
    const oldScale = stageScale;
    const newScale = Math.max(0.1, Math.min(direction === 1 ? oldScale * scaleBy : oldScale / scaleBy, 10));

    const center = { x: dimensions.width / 2, y: dimensions.height / 2 };
    const mousePointTo = { x: (center.x - stagePos.x) / oldScale, y: (center.y - stagePos.y) / oldScale };

    setStageScale(newScale);
    setStagePos({ x: center.x - mousePointTo.x * newScale, y: center.y - mousePointTo.y * newScale });
  };

  const handleNextStep = () => {
    if (step === 'reference' && refPoints.length === 4) {
      setStep('area');
    } else if (step === 'area' && areaPoints.length >= 6) {
      setStep('done');
      onPointsConfirmed(refPoints, areaPoints);
      setAreaPoints([]); 
    }
  };

  const handleUndo = () => {
    if (step === 'area') {
      if (areaPoints.length > 0) setAreaPoints(areaPoints.slice(0, -2)); 
      else if (savedFaces.length === 0) setStep('reference'); 
    } else if (step === 'reference') {
      if (refPoints.length > 0) setRefPoints(refPoints.slice(0, -2));
    }
  };

  const handleReset = () => {
    setRefPoints([]); setAreaPoints([]); setStep('reference');
    setStageScale(1); setStagePos({ x: 0, y: 0 });
    onPointsConfirmed([], []); fitImageToStage(); 
  };

  if (!imageUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg overflow-hidden flex-none">
        <p className="mb-4 text-gray-500 font-medium">ドローン画像をアップロードしてください</p>
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-md shadow-sm">
          画像を選択する
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
      </div>
    );
  }

  const refOpacity = step === 'reference' ? 1 : 0.6;
  const refPxLength = refPoints.length >= 4 ? Math.hypot(refPoints[2] - refPoints[0], refPoints[3] - refPoints[1]) : 0;
  const pxToMeter = refPxLength > 0 ? calibLength / refPxLength : 0;
  const totalActiveCount = savedFaces.reduce((sum, f) => sum + (f.activePanels ? f.activePanels.filter(v=>v).length : 0), 0);

  // ★復旧：辺の長さを描画する共通関数
  const renderEdgeLengths = (points: number[], isClosed: boolean, idPrefix: string) => {
    if (points.length < 4 || pxToMeter === 0) return null;
    const labels = [];
    const numEdges = isClosed ? points.length : points.length - 2;
    
    for (let i = 0; i < numEdges; i += 2) {
      const nextI = (i + 2) % points.length;
      const x1 = points[i], y1 = points[i+1];
      const x2 = points[nextI], y2 = points[nextI+1];
      const lenPx = Math.hypot(x2 - x1, y2 - y1);
      const lenM = (lenPx * pxToMeter).toFixed(1);

      labels.push(
        <Text
          key={`${idPrefix}-len-${i}`} x={(x1 + x2) / 2} y={(y1 + y2) / 2}
          text={`${lenM}m`} fontSize={15 / stageScale} fill="#1d4ed8" stroke="#ffffff" strokeWidth={4 / stageScale}
          fillAfterStrokeEnabled fontStyle="bold" offsetX={20 / stageScale} offsetY={15 / stageScale}
        />
      );
    }
    return labels;
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-2 px-4 flex-none">
        <div className="flex items-center space-x-2">
          {step === 'reference' && <p className="text-sm font-bold text-red-600 animate-pulse">【Step 1】屋根の「軒」に沿って、2点をタップし基準線を引いてください</p>}
          {step === 'area' && <p className="text-sm font-bold text-blue-600 animate-pulse">【Step 2】屋根の角をタップして、エリアを囲んでください</p>}
          {step === 'done' && <p className="text-sm font-medium text-gray-600">エリア指定完了 (右側の「新しい屋根面を追加」で複数設定可能)</p>}
        </div>
        <div className="space-x-2 flex">
          {step === 'reference' && refPoints.length === 4 && <button onClick={handleNextStep} className="px-4 py-2 bg-red-600 text-white font-bold rounded-md text-sm shadow-sm">次へ (エリア指定)</button>}
          {step === 'area' && areaPoints.length >= 6 && <button onClick={handleNextStep} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-md text-sm shadow-sm">この面を確定する</button>}
          {step !== 'done' && <button onClick={handleUndo} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-bold rounded-md text-sm transition-colors shadow-sm">1つ戻る</button>}
          <button onClick={handleReset} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md text-sm transition-colors">やり直し(全消去)</button>
        </div>
      </div>
      
      <div ref={containerRef} className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-200 flex-grow shadow-inner relative cursor-crosshair touch-none">
        <div className="absolute top-2 right-2 flex flex-col gap-2 z-10">
          <button onClick={() => handleZoom(1)} className="w-12 h-12 bg-white/90 border border-gray-300 rounded-lg shadow-md flex items-center justify-center text-2xl font-bold text-gray-700 hover:bg-gray-100">＋</button>
          <button onClick={() => handleZoom(-1)} className="w-12 h-12 bg-white/90 border border-gray-300 rounded-lg shadow-md flex items-center justify-center text-2xl font-bold text-gray-700 hover:bg-gray-100">－</button>
        </div>

        {savedFaces.length > 0 && (
          <div className="absolute top-2 left-2 bg-white/90 p-2 rounded text-xs font-bold text-amber-900 z-10 border border-amber-200 pointer-events-none shadow-sm">
            全エリア合計: {totalActiveCount} 枚
          </div>
        )}
        
        <Stage 
          width={dimensions.width} height={dimensions.height} 
          onClick={handleStageClick} onTap={handleStageClick} onWheel={handleWheel} 
          scaleX={stageScale} scaleY={stageScale} x={stagePos.x} y={stagePos.y} draggable            
          onDragEnd={(e) => { if(e.target.className !== 'Circle') setStagePos({ x: e.target.x(), y: e.target.y() }); }}
        >
          <Layer>
            {image && <KonvaImage image={image} width={image.width} height={image.height} />}
            
            {/* 確定済みの面 */}
            {savedFaces.map((face, fIndex) => (
              <React.Fragment key={`face-${fIndex}`}>
                {face.areaPoints.length > 0 && <Line points={face.areaPoints} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth={6 / stageScale} closed={true} />}
                {/* ★復活：確定済みエリアの長さも表示する */}
                {renderEdgeLengths(face.areaPoints, true, `saved-${fIndex}`)}
                
                {face.placedPanelsCoords.map((pts, pIndex) => {
                  const isActive = face.activePanels[pIndex];
                  return (
                    <Line 
                      key={`panel-${fIndex}-${pIndex}`} points={pts} closed={true} 
                      fill={isActive ? "rgba(251, 191, 36, 0.6)" : "rgba(156, 163, 175, 0.4)"} 
                      stroke={isActive ? "#f59e0b" : "#9ca3af"} strokeWidth={1 / stageScale} 
                      listening={step === 'done'}
                      onClick={(e) => { e.cancelBubble = true; if (onTogglePanel) onTogglePanel(fIndex, pIndex); }}
                      onTap={(e) => { e.cancelBubble = true; if (onTogglePanel) onTogglePanel(fIndex, pIndex); }}
                      onMouseEnter={(e) => { const c = e.target.getStage()?.container(); if(c) c.style.cursor = 'pointer'; }}
                      onMouseLeave={(e) => { const c = e.target.getStage()?.container(); if(c) c.style.cursor = 'crosshair'; }}
                    />
                  );
                })}
              </React.Fragment>
            ))}

            {/* 現在描画中のエリア */}
            {areaPoints.length > 0 && <Line points={areaPoints} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth={6 / stageScale} closed={step === 'done'} />}
            
            {/* ★復活：描画中エリアの長さ表示 */}
            {step === 'area' && renderEdgeLengths(areaPoints, false, 'drawing')}

            {step === 'area' && areaPoints.map((_, index) => {
              if (index % 2 === 0) {
                return (
                  <Circle 
                    key={`area-${index}`} x={areaPoints[index]} y={areaPoints[index + 1]} 
                    radius={7.5 / stageScale} fill="#ef4444" stroke="#ffffff" strokeWidth={2 / stageScale} draggable listening
                    onDragMove={(e) => {
                      const newPts = [...areaPoints];
                      newPts[index] = e.target.x(); newPts[index + 1] = e.target.y();
                      setAreaPoints(newPts);
                    }}
                  />
                );
              }
              return null;
            })}

            {/* 基準線 */}
            {refPoints.length > 0 && <Line points={refPoints} stroke="#dc2626" strokeWidth={6 / stageScale} dash={[10 / stageScale, 5 / stageScale]} opacity={refOpacity} />}
            {refPoints.length === 4 && (
              <Text
                x={(refPoints[0] + refPoints[2]) / 2} y={(refPoints[1] + refPoints[3]) / 2} text={`基準線: ${calibLength}m`}
                fontSize={16 / stageScale} fill="#b91c1c" stroke="#ffffff" strokeWidth={4 / stageScale} fillAfterStrokeEnabled fontStyle="bold" offsetX={30 / stageScale} offsetY={20 / stageScale} opacity={refOpacity}
              />
            )}
            {refPoints.map((_, index) => {
              if (index % 2 === 0) {
                return (
                  <Circle 
                    key={`ref-${index}`} x={refPoints[index]} y={refPoints[index + 1]} 
                    radius={7.5 / stageScale} fill="#dc2626" opacity={refOpacity}
                    draggable={step === 'reference'} listening={step === 'reference'} 
                    onDragMove={(e) => {
                      const newPts = [...refPoints];
                      newPts[index] = e.target.x(); newPts[index + 1] = e.target.y();
                      setRefPoints(newPts);
                    }}
                  />
                );
              }
              return null;
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}