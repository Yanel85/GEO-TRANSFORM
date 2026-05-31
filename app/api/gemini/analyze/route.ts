import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

// Lazy-initialize GoogleGenAI client inside the handler or dynamically to avoid crash on startup if key is missing.
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fileName,
      shapeType,
      bbox,
      featureCount,
      vertexCount,
      attributes,
      fileSizeOriginal,
    } = body;

    const prompt = `您是一位专业的地理信息系统（GIS）与移动前端开发专家。
请为用户提供关于如何将以下 Shapefile 数据整合进微信小程序（WeChat Mini Program）中的高级分析与优化指南：

**地图原始数据元数据：**
- 文件名: ${fileName || "未命名地块数据"}
- 几何类型: ${shapeType || "未知"}
- 边界框 (BBox [LngMin, LatMin, LngMax, LatMax]): ${JSON.stringify(bbox || [])}
- 要素总数: ${featureCount || 0} 个
- 节点总数 (Vertices count): ${vertexCount || 0} 个
- 属性列表及示例 (DBF Fields): ${JSON.stringify(attributes || [])}
- 原始文件总体体积: ${(fileSizeOriginal / 1024).toFixed(1)} KB

请输出一份内容极其专业、格式精美（支持 Markdown）的诊断优化指南，包含以下板块：

### 1. 微信小程序地图渲染性能诊断 (WeChat Map Rendering Diagnostics)
- 分析以此要素数量和节点数量直接在微信小程序 \`<map>\` 组件中渲染时，可能会产生什么样的性能卡顿（例如：小程序包大小超限、多边形加载缓慢、交互滞后等）。
- 针对当前范围大小及精度，给出对于数据简化的诊断结论。

### 2. 属性字段裁剪与体积压缩建议 (Attribute Pruning Guidance)
- 仔细阅读属性字段及示例数据，识别出哪些是 GIS 基础冗余字段（比如 FID, OBJECTID, Shape_Area 等），哪些可能在业务中极有用。
- 给出一个属性删除清单，并估计删掉它们后能节约多少 GeoJSON 文件体积。

### 3. 数据转换与坐标系校准说明 (Coordinate System Calibration)
- 解释为什么直接导入 WGS-84 (GPS) 坐标到微信小程序地图会产生数百米飘移。
- 精细讲解 GCJ-02 火星坐标系的工作机制以及该数据完成 GCJ-02 转换后的呈现精确度。

### 4. 专属微信小程序矢量图层渲染代码示例 (Tailored WeChat Boilerplate)
- 根据本次 Shapefile 的具体属性字段（分析具有分类、价格、名称或面积的属性，例如 ${JSON.stringify(Object.keys(attributes || {}).slice(0, 3)) || "属性"}），为用户定制一套能在微信小程序中跑通的极其优雅的 JavaScript / WXML 代码。
- 该代码不仅要画图，还要通过属性里的类别信息自动映射不同颜色的多边形 (polygons) 或折线 (polylines)，并在用户点击图层要素时弹出对应的自定义气泡显示其名称及关键业务参数。
- 保证代码拼写正确，并附带简洁的逻辑注释。`;

    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a bilingual GIS and front-end optimization agent. Give highly practical, clear, structured responses in Chinese, formatted in beautiful markdown.",
        temperature: 0.2,
      },
    });

    const adviceText = response.text || "无法生成报告。请检查 API 配置或数据完整性。";

    return NextResponse.json({ success: true, advice: adviceText });
  } catch (error: any) {
    console.error("Gemini analysis API error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "内部服务器在执行 AI 诊断时发生错误。" },
      { status: 500 }
    );
  }
}
