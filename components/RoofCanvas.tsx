"use client";

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from 'react-konva';
import useImage from 'use-image';

interface RoofCanvasProps {
  onPointsConfirmed: (refLine: number[], areaPoints: number[]) => void;
  placedPanels: Array<number[]>; 
  simulateTrigger?: number; 
  calibLength?: number; 
  // ★追加：パネルのON/OFF状態と、クリックされた時の合図を送る機能
  activePanels?: boolean[];
  onTogglePanel?: (index: number) => void;
}

export default function RoofCanvas({ onPointsConfirmed, placedPanels, simulateTrigger, calibLength = 10, activePanels, onTogglePanel }: RoofCanvasProps) {
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

  useEffect(() => {
    fitImageToStage();
  }, [fitImageToStage, dimensions]);

  useEffect(() => {
    if (simulateTrigger && simulateTrigger > 0) {
      fitImageToStage();
    }
  }, [simulateTrigger, fitImageToStage]);

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

  const handleZoom = (direction: 1 | -1) => {
    const scaleBy = 1.2;
    const oldScale = stageScale;
    const newScale = direction === 1 ? oldScale * scaleBy : oldScale / scaleBy;
    const limitedScale = Math.max(0.1, Math.min(newScale, 10));

    const center = {
      x: dimensions.width / 2,
      y: dimensions.height / 2,
    };

    const mousePointTo = {
      x: (center.x - stagePos.x) / oldScale,
      y: (center.y - stagePos.y) / oldScale,
    };

    setStageScale(limitedScale);
    setStagePos({
      x: center.x - mousePointTo.x * limitedScale,
      y: center.y - mousePointTo.y * limitedScale,
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
    fitImageToStage(); 
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

  // アクティブなパネルの枚数を数える
  const activeCount = activePanels ? activePanels.filter(v => v).length : placedPanels.length;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-2 px-4 flex-none">
        <div className="flex items-center space-x-2">
          {step === 'reference' && <p className="text-sm font-bold text-red-600 animate-pulse">【Step 1】屋根の「軒」に沿って、2点をタップし基準線を引いてください</p>}
          {step === 'area' && <p className="text-sm font-bold text-blue-600 animate-pulse">【Step 2】屋根の角をタップして、エリアを囲んでください</p>}
          {step === 'done' && <p className="text-sm font-medium text-gray-600">エリア指定完了 (パネルをタップで除外/追加できます)</p>}
        </div>
        <div className="space-x-2 flex">
          {step === 'reference' && refPoints.length === 4 && (
            <button onClick={handleNextStep} className="px-4 py-2 bg-red-600 text-white font-bold rounded-md text-sm shadow-sm">次へ (エリア指定)</button>
          )}
          {step === 'area' && areaPoints.length >= 6 && (
            <button onClick={handleNextStep} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-md text-sm shadow-sm">レイアウト範囲指定</button>
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
        className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-200 flex-grow shadow-inner relative cursor-crosshair touch-none"
      >
        <div className="absolute top-2 right-2 flex flex-col gap-2 z-10">
          <button 
            onClick={() => handleZoom(1)} 
            className="w-12 h-12 bg-white/90 border border-gray-300 rounded-lg shadow-md flex items-center justify-center text-2xl font-bold text-gray-700 hover:bg-gray-100 touch-manipulation"
          >
            ＋
          </button>
          <button 
            onClick={() => handleZoom(-1)} 
            className="w-12 h-12 bg-white/90 border border-gray-300 rounded-lg shadow-md flex items-center justify-center text-2xl font-bold text-gray-700 hover:bg-gray-100 touch-manipulation"
          >
            －
          </button>
        </div>

        {step === 'done' && placedPanels.length > 0 && (
          <div className="absolute top-2 left-2 bg-white/90 p-2 rounded text-xs font-bold text-amber-900 z-10 border border-amber-200 pointer-events-none">
            設置イメージ表示中 (有効: {activeCount} 枚)
          </div>
        )}
        
        <div className="absolute bottom-2 right-2 bg-white/90 p-2 rounded text-[10px] text-gray-600 z-10 pointer-events-none border border-gray-300 shadow-sm overflow-hidden">
          🖱 右上ボタン: 拡大・縮小<br/>
          👆 1本指ドラッグ: 画像を移動<br/>
          🎯 パネルをタップ: ON/OFF切替
        </div>

        <Stage 
          width={dimensions.width} 
          height={dimensions.height} 
          onClick={handleStageClick} 
          onTap={handleStageClick} 
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
                  width={image.width} 
                  height={image.height} 
               />
            )}
            
            {/* ★修正：パネルの描画（クリック検知とグレーアウト化） */}
            {step === 'done' && placedPanels.map((pts, index) => {
              const isActive = activePanels && activePanels.length > index ? activePanels[index] : true;
              return (
                <Line 
                  key={`panel-${index}`} 
                  points={pts} 
                  closed={true} 
                  // ONなら黄色、OFFなら薄いグレー
                  fill={isActive ? "rgba(251, 191, 36, 0.6)" : "rgba(156, 163, 175, 0.4)"} 
                  stroke={isActive ? "#f59e0b" : "#9ca3af"} 
                  strokeWidth={1 / stageScale} 
                  listening={step === 'done'}
                  onClick={(e) => {
                    e.cancelBubble = true; // 屋根エリアのクリック判定を防ぐ
                    if (onTogglePanel) onTogglePanel(index);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    if (onTogglePanel) onTogglePanel(index);
                  }}
                  onMouseEnter={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = 'pointer';
                  }}
                  onMouseLeave={(e) => {
                    const container = e.target.getStage()?.container();
                    if (container) container.style.cursor = 'crosshair';
                  }}
                />
              );
            })}

            {refPoints.length > 0 && (
              <Line points={refPoints} stroke="#dc2626" strokeWidth={6 / stageScale} dash={[10 / stageScale, 5 / stageScale]} opacity={refOpacity} />
            )}
            {refPoints.length === 4 && (
              <Text
                x={(refPoints[0] + refPoints[2]) / 2}
                y={(refPoints[1] + refPoints[3]) / 2}
                text={`基準線: ${calibLength}m`}
                fontSize={16 / stageScale}
                fill="#b91c1c"
                stroke="#ffffff"
                strokeWidth={4 / stageScale}
                fillAfterStrokeEnabled={true}
                fontStyle="bold"
                offsetX={30 / stageScale}
                offsetY={20 / stageScale}
                opacity={refOpacity}
              />
            )}

            {refPoints.map((_, index) => {
              if (index % 2 === 0) {
                return (
                  <Circle 
                    key={`ref-${index}`} 
                    x={refPoints[index]} 
                    y={refPoints[index + 1]} 
                    radius={7.5 / stageScale} 
                    fill="#dc2626" 
                    opacity={refOpacity}
                    draggable={step === 'reference' || step === 'done'}
                    listening={step === 'reference' || step === 'done'} 
                    onDragMove={(e) => {
                      const newPts = [...refPoints];
                      newPts[index] = e.target.x();
                      newPts[index + 1] = e.target.y();
                      setRefPoints(newPts);
                    }}
                    onDragEnd={(e) => {
                      if (step === 'done') {
                        const newPts = [...refPoints];
                        newPts[index] = e.target.x();
                        newPts[index + 1] = e.target.y();
                        onPointsConfirmed(newPts, areaPoints);
                      }
                    }}
                  />
                );
              }
              return null;
            })}

            {areaPoints.length > 0 && (
              <Line points={areaPoints} fill="rgba(59, 130, 246, 0.3)" stroke="#3b82f6" strokeWidth={6 / stageScale} closed={step === 'done'} />
            )}
            {areaPoints.length >= 4 && pxToMeter > 0 && (() => {
              const labels = [];
              for (let i = 0; i < areaPoints.length; i += 2) {
                const isLast = i === areaPoints.length - 2;
                if (isLast && step !== 'done') continue;

                const nextI = isLast ? 0 : i + 2;
                const x1 = areaPoints[i];
                const y1 = areaPoints[i+1];
                const x2 = areaPoints[nextI];
                const y2 = areaPoints[nextI+1];

                const lenPx = Math.hypot(x2 - x1, y2 - y1);
                const lenM = (lenPx * pxToMeter).toFixed(1);

                labels.push(
                  <Text
                    key={`len-${i}`}
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2}
                    text={`${lenM}m`}
                    fontSize={15 / stageScale}
                    fill="#1d4ed8"
                    stroke="#ffffff"
                    strokeWidth={4 / stageScale}
                    fillAfterStrokeEnabled={true}
                    fontStyle="bold"
                    offsetX={20 / stageScale}
                    offsetY={15 / stageScale}
                  />
                );
              }
              return labels;
            })()}

            {areaPoints.map((_, index) => {
              if (index % 2 === 0) {
                return (
                  <Circle 
                    key={`area-${index}`} 
                    x={areaPoints[index]} 
                    y={areaPoints[index + 1]} 
                    radius={7.5 / stageScale} 
                    fill="#ef4444" 
                    stroke="#ffffff" 
                    strokeWidth={2 / stageScale}
                    draggable={step === 'area' || step === 'done'}
                    listening={step === 'area' || step === 'done'}
                    onDragMove={(e) => {
                      const newPts = [...areaPoints];
                      newPts[index] = e.target.x();
                      newPts[index + 1] = e.target.y();
                      setAreaPoints(newPts);
                    }}
                    onDragEnd={(e) => {
                      if (step === 'done') {
                        const newPts = [...areaPoints];
                        newPts[index] = e.target.x();
                        newPts[index + 1] = e.target.y();
                        onPointsConfirmed(refPoints, newPts);
                      }
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