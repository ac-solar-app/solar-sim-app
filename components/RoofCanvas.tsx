"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva';
import useImage from 'use-image';

interface RoofCanvasProps {
  onPointsConfirmed: (refLine: number[], areaPoints: number[]) => void;
  placedPanels: Array<number[]>; 
}

export default function RoofCanvas({ onPointsConfirmed, placedPanels }: RoofCanvasProps) {
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      setStep('reference'); 
    }
  };

  const handleStageClick = (e: any) => {
    if (e.target.className === 'Circle' || e.target.parent?.className === 'Transformer') return;
    if (e.evt.type === 'touchend' && e.evt.touches && e.evt.touches.length > 0) return;
    
    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();
    const x = (pointerPos.x - stage.x()) / stage.scaleX();
    const y = (pointerPos.y - stage.y()) / stage.scaleY();

    if (step === 'reference') {
      if (refPoints.length < 4) {
        setRefPoints([...refPoints, x, y]);
      }
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

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const limitedScale = Math.max(0.1, Math.min(newScale, 10));

    setStageScale(limitedScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * limitedScale,
      y: pointer.y - mousePointTo.y * limitedScale,
    });
  };

  const handleNextStep = () => {
    if (step === 'reference' && refPoints.length === 4) {
      setStep('area');
    } else if (step === 'area' && areaPoints.length >= 6) {
      setStep('done');
      onPointsConfirmed(refPoints, areaPoints);
    }
  };

  const handleUndo = () => {
    if (step === 'area') {
      if (areaPoints.length > 0) {
        setAreaPoints(areaPoints.slice(0, -2)); 
      } else {
        setStep('reference'); 
      }
    } else if (step === 'reference') {
      if (refPoints.length > 0) {
        setRefPoints(refPoints.slice(0, -2));
      }
    }
  };

  const handleReset = () => {
    setRefPoints([]);
    setAreaPoints([]);
    setStep('reference');
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
    onPointsConfirmed([], []);
  };

  if (!imageUrl) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg">
        <p className="mb-4 text-gray-500 font-medium">ドローン画像をアップロードしてください</p>
        <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-md shadow-sm">
          画像を選択する
          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        </label>
      </div>
    );
  }

  const refOpacity = step === 'reference' ? 1 : 0.4;

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-2 px-4">
        <div className="flex items-center space-x-2">
          {step === 'reference' && <p className="text-sm font-bold text-red-600 animate-pulse">【Step 1】屋根の「軒」に沿って、2点をタップし基準線を引いてください</p>}
          {step === 'area' && <p className="text-sm font-bold text-blue-600 animate-pulse">【Step 2】屋根の角をタップして、エリアを囲んでください</p>}
          {step === 'done' && <p className="text-sm font-medium text-gray-600">エリア指定完了</p>}
        </div>
        <div className="space-x-2 flex">
          {step === 'reference' && refPoints.length === 4 && (
            <button onClick={handleNextStep} className="px-4 py-2 bg-red-600 text-white font-bold rounded-md text-sm shadow-sm">次へ (エリア指定)</button>
          )}
          {step === 'area' && areaPoints.length >= 6 && (
            <button onClick={handleNextStep} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-md text-sm shadow-sm">決定 (閉じる)</button>
          )}
          
          {step !== 'done' && (
            <button onClick={handleUndo} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-bold rounded-md text-sm transition-colors shadow-sm">
              1つ戻る
            </button>
          )}
          
          <button onClick={handleReset} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md text-sm transition-colors">
            やり直し
          </button>
        </div>
      </div>
      
      <div 
        ref={containerRef}
        className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-200 flex-grow shadow-inner relative cursor-crosshair"
      >
        {step === 'done' && placedPanels.length > 0 && (
          <div className="absolute top-2 left-2 bg-white/90 p-2 rounded text-xs font-bold text-amber-900 z-10 border border-amber-200 pointer-events-none">
            設置イメージ表示中 ({placedPanels.length} 枚)
          </div>
        )}
        
        {step !== 'done' && (
           <div className="absolute bottom-2 right-2 bg-white/90 p-2 rounded text-[10px] text-gray-600 z-10 pointer-events-none border border-gray-300 shadow-sm">
             🖱 マウスホイール: 拡大/縮小<br/>
             👆 ドラッグ: 画像を移動<br/>
             🎯 点をドラッグ: 位置の微調整
           </div>
        )}

        <Stage 
          width={dimensions.width} 
          height={dimensions.height} 
          onClick={handleStageClick} 
          onTouchEnd={handleStageClick}
          onWheel={handleWheel} 
          scaleX={stageScale}   
          scaleY={stageScale}
          x={stagePos.x}        
          y={stagePos.y}
          draggable           
          onDragEnd={(e) => {
             if(e.target.className !== 'Circle') {
               setStagePos({ x: e.target.x(), y: e.target.y() });
             }
          }}
        >
          <Layer>
            {image && (
               <KonvaImage 
                  image={image} 
                  width={dimensions.width} 
                  height={dimensions.width * (image.height / image.width)} 
               />
            )}
            
            {step === 'done' && placedPanels.map((pts, index) => (
              <Line key={`panel-${index}`} points={pts} closed={true} fill="rgba(251, 191, 36, 0.6)" stroke="#f59e0b" strokeWidth={1} />
            ))}

            {refPoints.length > 0 && (
              <Line points={refPoints} stroke="#dc2626" strokeWidth={3} dash={[10, 5]} opacity={refOpacity} />
            )}
            {refPoints.map((_, index) => {
              if (index % 2 === 0) {
                return (
                  <Circle 
                    key={`ref-${index}`} 
                    x={refPoints[index]} 
                    y={refPoints[index + 1]} 
                    radius={6 / stageScale} 
                    fill="#dc2626" 
                    opacity={refOpacity}
                    draggable={step === 'reference'}
                    // ★追加：基準線ステップの時だけ当たり判定を有効にする
                    listening={step === 'reference'} 
                    onDragMove={(e) => {
                      const newPts = [...refPoints];
                      newPts[index] = e.target.x();
                      newPts[index + 1] = e.target.y();
                      setRefPoints(newPts);
                    }}
                  />
                );
              }
              return null;
            })}

            {areaPoints.length > 0 && (
              <Line points={areaPoints} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth={3 / stageScale} closed={step === 'done'} />
            )}
            {areaPoints.map((_, index) => {
              if (index % 2 === 0) {
                return (
                  <Circle 
                    key={`area-${index}`} 
                    x={areaPoints[index]} 
                    y={areaPoints[index + 1]} 
                    radius={5 / stageScale} 
                    fill="#ef4444" 
                    stroke="#ffffff" 
                    strokeWidth={2 / stageScale}
                    draggable={step === 'area'}
                    // ★追加：エリア指定ステップの時だけ当たり判定を有効にする
                    listening={step === 'area'}
                    onDragMove={(e) => {
                      const newPts = [...areaPoints];
                      newPts[index] = e.target.x();
                      newPts[index + 1] = e.target.y();
                      setAreaPoints(newPts);
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
// === ⬇️ コピーはここまで ⬇️ ===