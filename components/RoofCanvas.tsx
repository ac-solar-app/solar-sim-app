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

  // ★追加：iPadの2本指ピンチ操作の距離を記憶する変数
  const lastDist = useRef<number>(0);

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
    
    // ★追加：2本指で触っている時や、スワイプ終了時は「タップ（点打ち）」を無効化する
    if (e.evt.type === 'touchend' && e.evt.touches && e.evt.touches.length > 0) return;
    if (e.evt.changedTouches && e.evt.changedTouches.length > 1) return;
    
    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

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

  // PCのマウスホイール用ズーム
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

  // ★追加：iPadの2本指ピンチズーム処理
  const handleTouchMove = (e: any) => {
    e.evt.preventDefault(); // 画面全体がスクロールするのを防ぐ
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];

    if (touch1 && touch2) {
      const stage = e.target.getStage();
      if (!stage) return;

      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };

      // 指と指の間の距離を計算
      const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

      if (!lastDist.current) {
        lastDist.current = dist;
        return;
      }

      const scaleBy = dist / lastDist.current;
      const oldScale = stage.scaleX();
      const newScale = Math.max(0.1, Math.min(oldScale * scaleBy, 10));

      // 2本指の中心点を計算して、そこに向かってズームする
      const center = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
      };

      const stageBox = stage.container().getBoundingClientRect();
      const pointer = {
        x: center.x - stageBox.left,
        y: center.y - stageBox.top,
      };

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      setStageScale(newScale);
      setStagePos({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      });

      lastDist.current = dist;
    }
  };

  const handleTouchEndStage = (e: any) => {
    lastDist.current = 0; // 指を離したら距離をリセット
    handleStageClick(e);
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
      
      {/* ★追加：touch-none クラスをつけて、Safari自体のスクロールを止める */}
      <div 
        ref={containerRef}
        className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-200 flex-grow shadow-inner relative cursor-crosshair touch-none"
      >
        {step === 'done' && placedPanels.length > 0 && (
          <div className="absolute top-2 left-2 bg-white/90 p-2 rounded text-xs font-bold text-amber-900 z-10 border border-amber-200 pointer-events-none">
            設置イメージ表示中 ({placedPanels.length} 枚)
          </div>
        )}
        
        {step !== 'done' && (
           <div className="absolute bottom-2 right-2 bg-white/90 p-2 rounded text-[10px] text-gray-600 z-10 pointer-events-none border border-gray-300 shadow-sm">
             🖱 ホイール / 2本指: 拡大・縮小<br/>
             👆 1本指ドラッグ: 画像を移動<br/>
             🎯 点をドラッグ: 位置の微調整
           </div>
        )}

        <Stage 
          width={dimensions.width} 
          height={dimensions.height} 
          onClick={handleStageClick} 
          onTouchMove={handleTouchMove}      // ★追加
          onTouchEnd={handleTouchEndStage}   // ★追加
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
                    radius={15 / stageScale} // ★変更：指で触りやすいように半径を大きくしました
                    fill="#dc2626" 
                    opacity={refOpacity}
                    draggable={step === 'reference'}
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
                    radius={15 / stageScale} // ★変更：ここも指で触りやすいように大きくしました
                    fill="#ef4444" 
                    stroke="#ffffff" 
                    strokeWidth={2 / stageScale}
                    draggable={step === 'area'}
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