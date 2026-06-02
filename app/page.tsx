'use client';

import { useEffect, useState, useRef } from 'react';
import {
  FileUp,
  Sliders,
  Maximize2,
  RefreshCw,
  Cpu,
  Download,
  Info,
  Layers,
  MapPin,
  Brackets,
  BookOpen,
  CheckCircle,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  HelpCircle,
  FileCheck2,
  Minimize,
  Sparkles,
  ChevronRight,
  Eye
} from 'lucide-react';
import {
  wgs84ToGcj02,
  simplifyGeometry,
  convertGeometryToGcj02,
  trimGeometryPrecision,
  calculateBBox,
  countVertices,
  roundCoords
} from '@/lib/map-utils';

// Common EPSG projections database pre-loaded to operate 100% offline
const EPSG_PRESETS = [
  { code: 'EPSG:4326', name: 'WGS 84 (地理坐标系 - 经纬度)', proj: '+proj=longlat +datum=WGS84 +no_defs' },
  { code: 'EPSG:4490', name: 'CGCS2000 (国家2000地理坐标系 - 经纬度)', proj: '+proj=longlat +ellps=GRS80 +no_defs' },
  { code: 'EPSG:3857', name: 'Web Mercator (网络墨卡托投影 - 米)', proj: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs' },
  { code: 'EPSG:32650', name: 'WGS 84 / UTM Zone 50N (北京/四川等中部地区 - 米)', proj: '+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:32651', name: 'WGS 84 / UTM Zone 51N (上海/浙江等东部地区 - 米)', proj: '+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs' },
  { code: 'EPSG:4547', name: 'CGCS2000 / 3-deg GK Zone 38 (高斯克吕格114E CM - 米)', proj: '+proj=tmerc +lat_0=0 +lon_0=114 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:4548', name: 'CGCS2000 / 3-deg GK Zone 39 (高斯克吕格117E CM - 米)', proj: '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs' },
  { code: 'EPSG:4549', name: 'CGCS2000 / 3-deg GK Zone 40 (高斯克吕格120E CM - 米)', proj: '+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs' },
];

export default function ConverterPage() {
  // Parsing states
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [detectedCRS, setDetectedCRS] = useState<string>('未检测到项目描述');
  const [selectedProjection, setSelectedProjection] = useState<string>('EPSG:4326');
  const [customProj4Str, setCustomProj4Str] = useState<string>('');

  // Filename loaded
  const [loadedFileName, setLoadedFileName] = useState<string>('');

  // Loaded metadata files tracking
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; size: number; ext: string }[]>([]);

  // Original & Processed Data
  const [originalGeoJson, setOriginalGeoJson] = useState<any>(null);
  const [processedGeoJson, setProcessedGeoJson] = useState<any>(null);

  // Statistics
  const [origStats, setOrigStats] = useState({ size: 0, vertices: 0, features: 0 });
  const [procStats, setProcStats] = useState({ size: 0, vertices: 0, features: 0 });

  // Parameter states
  const [simplifyValue, setSimplifyValue] = useState<number>(10); // 0-100 scale slider
  const [precisionValue, setPrecisionValue] = useState<number>(6); // decimals
  const [enableGcj02, setEnableGcj02] = useState<boolean>(true);
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  const [allProperties, setAllProperties] = useState<string[]>([]);
  const [propertySamples, setPropertySamples] = useState<{ [key: string]: any }>({});

  // Navigation Visualizer States
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [hoveredFeature, setHoveredFeature] = useState<any>(null);
  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [inspectCoordinates, setInspectCoordinates] = useState<[number, number] | null>(null);

  // Canvas interaction
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const velocityRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const inertiaFrameRef = useRef<number | null>(null);
  const [showZoomHUD, setShowZoomHUD] = useState<boolean>(false);

  // Automatic fade out for zoom HUD
  useEffect(() => {
    setShowZoomHUD(true);
    const timer = setTimeout(() => {
      setShowZoomHUD(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, [zoom]);

  // Clean inertia on unmount
  useEffect(() => {
    return () => {
      if (inertiaFrameRef.current) {
        cancelAnimationFrame(inertiaFrameRef.current);
      }
    };
  }, []);

  // Map limits
  const mapBBoxRef = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  const mapScaleRef = useRef<number>(1);
  const mapOffsetYRef = useRef<number>(0);
  const mapOffsetXRef = useRef<number>(0);



  // Parse WKT .prj file to automatically suggest projection presets
  const handlePrjString = (prjText: string) => {
    const prj = prjText.toUpperCase();
    setDetectedCRS(prjText.trim().substring(0, 120) + (prjText.length > 120 ? '...' : ''));

    if (prj.includes('WGS_1984_UTM_ZONE_50N') || prj.includes('UTM_ZONE_50N')) {
      setSelectedProjection('EPSG:32650');
    } else if (prj.includes('WGS_1984_UTM_ZONE_51N') || prj.includes('UTM_ZONE_51N')) {
      setSelectedProjection('EPSG:32651');
    } else if (prj.includes('CGCS2000_3_DEGREE_GK_ZONE_38') || prj.includes('3_DEGREE_GK_38')) {
      setSelectedProjection('EPSG:4547');
    } else if (prj.includes('CGCS2000_3_DEGREE_GK_ZONE_39') || prj.includes('3_DEGREE_GK_39')) {
      setSelectedProjection('EPSG:4548');
    } else if (prj.includes('CGCS2000_3_DEGREE_GK_ZONE_40') || prj.includes('3_DEGREE_GK_40')) {
      setSelectedProjection('EPSG:4549');
    } else if (prj.includes('CGCS2000')) {
      setSelectedProjection('EPSG:4490');
    } else if (prj.includes('WGS_1984')) {
      setSelectedProjection('EPSG:4326');
    } else if (prj.includes('MERCATOR') || prj.includes('POPULAR_VISUALISATION')) {
      setSelectedProjection('EPSG:3857');
    }
  };

  // Main processing pipeline
  function processMapData() {
    if (!originalGeoJson) return;

    setIsParsing(true);
    try {
      // 1. Projection Conversion (Degrees or meters coordinate system parsing)
      let sourceProj = '';
      if (selectedProjection === 'custom') {
        sourceProj = customProj4Str;
      } else {
        const p = EPSG_PRESETS.find(x => x.code === selectedProjection);
        sourceProj = p ? p.proj : '';
      }

      // Execute reproject geojson coordinates from local format to WGS-84
      let wgs84Data = JSON.parse(JSON.stringify(originalGeoJson));
      if (sourceProj && selectedProjection !== 'EPSG:4326') {
        // If we have non-geographic projection, reproject using proj4 client-side
        import('proj4').then((proj4Imp) => {
          const proj4 = proj4Imp.default;
          wgs84Data = reprojectGeoJSONClient(wgs84Data, proj4, sourceProj);
          finalizeProcessing(wgs84Data);
        }).catch(err => {
          console.error("Proj4 load failed", err);
          finalizeProcessing(wgs84Data); // Fallback to raw data
        });
      } else {
        finalizeProcessing(wgs84Data);
      }
    } catch (error: any) {
      console.error(error);
      setParseError('地图参数处理失败：' + error.message);
      setIsParsing(false);
    }
  }

  function reprojectGeoJSONClient(geojson: any, proj4Instance: any, fromProjStr: string): any {
    const toProjStr = '+proj=longlat +datum=WGS84 +no_defs';
    let transformer: any;
    try {
      transformer = proj4Instance(fromProjStr, toProjStr);
    } catch (err) {
      console.warn("Invalid Proj4 definition, bypassing reprojection:", err);
      return geojson;
    }

    const transformPair = (coord: [number, number]): [number, number] => {
      // Geographic boundaries check: if it's already within degrees scale, do not warp
      if (coord[0] >= -180 && coord[0] <= 180 && coord[1] >= -90 && coord[1] <= 90) {
        return coord;
      }
      try {
        const res = transformer.forward(coord);
        return [res[0], res[1]];
      } catch (e) {
        return coord;
      }
    };

    const transformGeom = (geom: any): any => {
      if (!geom) return geom;
      const type = geom.type;
      const coords = geom.coordinates;
      if (!coords) return geom;

      if (type === "Point") {
        return { ...geom, coordinates: transformPair(coords) };
      } else if (type === "MultiPoint" || type === "LineString") {
        return { ...geom, coordinates: coords.map(transformPair) };
      } else if (type === "MultiLineString" || type === "Polygon") {
        return { ...geom, coordinates: coords.map((line: any) => line.map(transformPair)) };
      } else if (type === "MultiPolygon") {
        return {
          ...geom,
          coordinates: coords.map((poly: any) =>
            poly.map((ring: any) => ring.map(transformPair))
          ),
        };
      }
      return geom;
    };

    if (geojson.type === "FeatureCollection") {
      return {
        ...geojson,
        features: geojson.features.map((f: any) => ({
          ...f,
          geometry: transformGeom(f.geometry),
        })),
      };
    } else if (geojson.type === "Feature") {
      return {
        ...geojson,
        geometry: transformGeom(geojson.geometry),
      };
    }
    return transformGeom(geojson);
  }

  function finalizeProcessing(wgs84Data: any) {
    // 2. Douglas-Peucker Simplification
    // Map slider 0-100 to degree scale tolerance squared range safely
    const tolerance = (simplifyValue / 100) * 0.001; // Max 0.001 degrees corresponds to ~110 meters

    let geomData = JSON.parse(JSON.stringify(wgs84Data));

    // Simplify geometry vertices
    if (tolerance > 0 && geomData.features) {
      geomData.features = geomData.features.map((f: any) => ({
        ...f,
        geometry: simplifyGeometry(f.geometry, tolerance)
      }));
    }

    // 3. WGS-84 to GCJ-02 (Chinese map offsets correction)
    if (enableGcj02 && geomData.features) {
      geomData.features = geomData.features.map((f: any) => ({
        ...f,
        geometry: convertGeometryToGcj02(f.geometry)
      }));
    }

    // 4. Coordinates Decimal Trim Precision
    if (geomData.features) {
      geomData.features = geomData.features.map((f: any) => ({
        ...f,
        geometry: trimGeometryPrecision(f.geometry, precisionValue)
      }));
    }

    // 5. Attributes (DBF Field) selection / Pruning
    if (geomData.features) {
      geomData.features = geomData.features.map((f: any) => {
        const props = f.properties || {};
        const pruned: any = {};
        selectedProperties.forEach(key => {
          if (props[key] !== undefined) {
            pruned[key] = props[key];
          }
        });
        return {
          ...f,
          properties: pruned
        };
      });
    }

    setProcessedGeoJson(geomData);

    // Compute live stats
    const sizeInBytes = JSON.stringify(geomData).length;
    const totalVerts = countVertices(geomData);
    setProcStats({
      size: sizeInBytes,
      vertices: totalVerts,
      features: geomData.features?.length || 0
    });
    setIsParsing(false);
  }

  // File Upload Handlers
  const handleUploadedFiles = async (filesList: File[]) => {
    setIsParsing(true);
    setParseError(null);

    const zipFile = filesList.find(f => f.name.endsWith('.zip'));
    const shpFile = filesList.find(f => f.name.endsWith('.shp'));
    const dbfFile = filesList.find(f => f.name.endsWith('.dbf'));
    const prjFile = filesList.find(f => f.name.endsWith('.prj'));
    const cpgFile = filesList.find(f => f.name.endsWith('.cpg'));

    // Visual Tracker
    const list = filesList.map(f => {
      const parts = f.name.split('.');
      return {
        name: f.name,
        size: f.size,
        ext: parts[parts.length - 1].toLowerCase()
      };
    });
    setUploadedFiles(list);

    try {
      const shpImp = await import('shpjs');
      const shpReader = shpImp.default;

      if (zipFile) {
        // Read zip
        const arrayBuffer = await zipFile.arrayBuffer();
        setLoadedFileName(zipFile.name.replace('.zip', ''));
        const geojson: any = await shpReader(arrayBuffer);

        let targetGeoJSON = geojson;
        if (Array.isArray(geojson)) {
          targetGeoJSON = geojson[0]; // Take primary feature layer inside zip
        }
        setupOriginalMapData(targetGeoJSON, zipFile.size);
      } else if (shpFile) {
        // Read individual shp and dbf files
        setLoadedFileName(shpFile.name.replace('.shp', ''));
        const shpBuffer = await shpFile.arrayBuffer();
        const dbfBuffer = dbfFile ? await dbfFile.arrayBuffer() : undefined;
        let cpgBuffer: ArrayBuffer;
        if (cpgFile) {
          cpgBuffer = await cpgFile.arrayBuffer();
        } else {
          cpgBuffer = new TextEncoder().encode('utf-8').buffer;
        }

        // If .prj text is present, parse it to extract initial coordinate projections
        if (prjFile) {
          const prjText = await prjFile.text();
          handlePrjString(prjText);
        } else {
          setDetectedCRS('无.prj文件，默认使用 WGS-84 地理坐标系');
          setSelectedProjection('EPSG:4326');
        }

        const shpParsed = shpImp.parseShp(shpBuffer);
        const dbfParsed = dbfBuffer ? shpImp.parseDbf(dbfBuffer, cpgBuffer) : [];
        const combinedGeoJSON = shpImp.combine([shpParsed, dbfParsed]);

        setupOriginalMapData(combinedGeoJSON, shpFile.size + (dbfFile?.size || 0));
      } else {
        setParseError('未探测到 Shapefile 主物理文件 (.shp) 或压缩包 (.zip)。');
        setIsParsing(false);
      }
    } catch (err: any) {
      console.error(err);
      setParseError('解析文件时产生故障：' + err.message);
      setIsParsing(false);
    }
  };

  const setupOriginalMapData = (geojson: any, sizeEst: number) => {
    setOriginalGeoJson(geojson);

    // Analyze properties fields (Attributes checklist creation)
    const propertyList = new Set<string>();
    const samples: { [key: string]: any } = {};

    if (geojson.features && geojson.features.length > 0) {
      geojson.features.slice(0, 10).forEach((f: any) => {
        if (f.properties) {
          Object.keys(f.properties).forEach(key => {
            propertyList.add(key);
            if (f.properties[key] !== undefined && f.properties[key] !== null) {
              samples[key] = f.properties[key];
            }
          });
        }
      });
    }

    const propArray = Array.from(propertyList);
    setAllProperties(propArray);
    setSelectedProperties(propArray); // keep all by default
    setPropertySamples(samples);

    const totalVerts = countVertices(geojson);
    setOrigStats({
      size: sizeEst || JSON.stringify(geojson).length,
      vertices: totalVerts,
      features: geojson.features?.length || 0
    });

    // Reset Visualizer View Coordinates
    setPanX(0);
    setPanY(0);
    setZoom(1);
    setSelectedFeature(null);
    setHoveredFeature(null);
  };



  // Convert canvas pixel point back to geographic coordinates
  const canvasToGeographic = (clientX: number, clientY: number): [number, number] | null => {
    if (!canvasRef.current || !processedGeoJson) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    const cx = canvasSize.width / 2;
    const cy = canvasSize.height / 2;

    // Remove Pan and Zoom transform matrix values
    const x = mx - cx - panX;
    const y = my - cy - panY;

    const x_unscaled = x / zoom;
    const y_unscaled = y / zoom;

    const px = x_unscaled + cx;
    const py = y_unscaled + cy;

    // Inverse projection formula conversion
    const scale = mapScaleRef.current;
    const listBBox = mapBBoxRef.current;

    const lng = (px - mapOffsetXRef.current) / scale + listBBox[0];
    const lat = (canvasSize.height - py - mapOffsetYRef.current) / scale + listBBox[1];

    return [lng, lat];
  };

  // Check if pointer point is inside Polygon (Ray-Casting Algorithm)
  const isPointInPolygon = (point: [number, number], polygon: [number, number][][]): boolean => {
    let inside = false;
    const x = point[0], y = point[1];
    const ring = polygon[0]; // Bound exterior boundary
    if (!ring) return false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const isPointCloseToLine = (point: [number, number], line: [number, number][], toleranceDeg: number): boolean => {
    const px = point[0], py = point[1];
    for (let i = 0; i < line.length - 1; i++) {
      const x1 = line[i][0], y1 = line[i][1];
      const x2 = line[i + 1][0], y2 = line[i + 1][1];

      // Distance from point to line segment
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (dx === 0 && dy === 0) continue;

      let u = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
      if (u < 0) u = 0;
      else if (u > 1) u = 1;

      const closestX = x1 + u * dx;
      const closestY = y1 + u * dy;

      const distSq = (closestX - px) ** 2 + (closestY - py) ** 2;
      if (distSq < toleranceDeg * toleranceDeg) return true;
    }
    return false;
  };

  const isPointCloseToPoint = (point: [number, number], target: [number, number], toleranceDeg: number): boolean => {
    const distSq = (point[0] - target[0]) ** 2 + (point[1] - target[1]) ** 2;
    return distSq < toleranceDeg * toleranceDeg;
  };

  // Find intersected feature under mouse coordinate
  const locateFeatureAtCoordinate = (geoPoint: [number, number]): any | null => {
    if (!processedGeoJson || !processedGeoJson.features) return null;
    const listBBox = mapBBoxRef.current;
    const bboxHeight = listBBox[3] - listBBox[1];
    const buffer = bboxHeight * 0.02; // adaptive collision buffer size

    // Iterate in reverse so visually top layers are detected first
    for (let i = processedGeoJson.features.length - 1; i >= 0; i--) {
      const feature = processedGeoJson.features[i];
      const type = feature.geometry?.type;
      const coords = feature.geometry?.coordinates;
      if (!coords) continue;

      if (type === 'Polygon') {
        if (isPointInPolygon(geoPoint, coords)) return feature;
      } else if (type === 'MultiPolygon') {
        for (const poly of coords) {
          if (isPointInPolygon(geoPoint, poly)) return feature;
        }
      } else if (type === 'LineString') {
        if (isPointCloseToLine(geoPoint, coords, buffer)) return feature;
      } else if (type === 'MultiLineString') {
        for (const line of coords) {
          if (isPointCloseToLine(geoPoint, line, buffer)) return feature;
        }
      } else if (type === 'Point') {
        if (isPointCloseToPoint(geoPoint, coords, buffer)) return feature;
      }
    }
    return null;
  };

  // Start inertia scrolling
  const startInertia = () => {
    if (inertiaFrameRef.current) cancelAnimationFrame(inertiaFrameRef.current);

    const decay = 0.94; // friction coefficient
    const animate = () => {
      const { x: vx, y: vy } = velocityRef.current;

      if (Math.abs(vx) < 0.08 && Math.abs(vy) < 0.08) {
        velocityRef.current = { x: 0, y: 0 };
        return;
      }

      setPanX(prev => prev + vx);
      setPanY(prev => prev + vy);

      // Decay velocity
      velocityRef.current = { x: vx * decay, y: vy * decay };

      inertiaFrameRef.current = requestAnimationFrame(animate);
    };
    inertiaFrameRef.current = requestAnimationFrame(animate);
  };

  // Canvas Interactions Event handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    velocityRef.current = { x: 0, y: 0 };

    if (inertiaFrameRef.current) {
      cancelAnimationFrame(inertiaFrameRef.current);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !processedGeoJson) return;

    if (isDraggingRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      setPanX(prev => prev + dx);
      setPanY(prev => prev + dy);
      
      // Store current speed as velocity
      velocityRef.current = { x: dx, y: dy };
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    } else {
      // Hover inspector logic
      const geoPos = canvasToGeographic(e.clientX, e.clientY);
      if (geoPos) {
        setInspectCoordinates(geoPos);
        const hit = locateFeatureAtCoordinate(geoPos);
        if (hit !== hoveredFeature) {
          setHoveredFeature(hit);
        }
      }
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = false;
    setIsDragging(false);

    // Apply inertia if there's significant move velocity left
    if (Math.abs(velocityRef.current.x) > 0.5 || Math.abs(velocityRef.current.y) > 0.5) {
      startInertia();
    }

    // Click selection logic using clientX delta tolerance
    if (Math.abs(e.clientX - lastMousePosRef.current.x) < 2 && Math.abs(e.clientY - lastMousePosRef.current.y) < 2) {
      const geoPos = canvasToGeographic(e.clientX, e.clientY);
      if (geoPos) {
        const hit = locateFeatureAtCoordinate(geoPos);
        setSelectedFeature(hit);
      }
    }
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!canvasRef.current) return;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    // Restricting zoom factor between 0.4x and 150x to avoid losing perspective
    const nextZoom = Math.min(Math.max(zoom * zoomFactor, 0.4), 150);

    setZoom(nextZoom);
  };

  // Vector Drawing Pipeline
  function drawMap() {
    const canvas = canvasRef.current;
    if (!canvas || !processedGeoJson) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset layout pixel buffers
    ctx.restore();
    ctx.save();
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    const cx = canvasSize.width / 2;
    const cy = canvasSize.height / 2;

    // Compute bounding scale values to center geographic points inside Canvas limits
    const listBBox = calculateBBox(processedGeoJson);
    mapBBoxRef.current = listBBox;

    const boundsW = listBBox[2] - listBBox[0];
    const boundsH = listBBox[3] - listBBox[1];

    if (boundsW === 0 || boundsH === 0) return;

    const pad = 0.90; // Fit in 90% margin bounds
    const centerLat = (listBBox[3] + listBBox[1]) / 2;
    const latStretch = Math.cos((centerLat * Math.PI) / 180);

    // Proportional stretch factor
    const stretchW = boundsW * latStretch;
    const sX = (canvasSize.width / boundsW) * pad;
    const sY = (canvasSize.height / boundsH) * pad;
    const scale = Math.min(sX, sY);

    mapScaleRef.current = scale;

    const offsetX = (canvasSize.width - boundsW * scale) / 2;
    const offsetY = (canvasSize.height - boundsH * scale) / 2;

    mapOffsetXRef.current = offsetX;
    mapOffsetYRef.current = offsetY;

    const projX = (lng: number) => {
      const baseRawX = (lng - listBBox[0]) * scale + offsetX;
      return (baseRawX - cx) * zoom + cx + panX;
    };
    const projY = (lat: number) => {
      const baseRawY = canvasSize.height - ((lat - listBBox[1]) * scale + offsetY);
      return (baseRawY - cy) * zoom + cy + panY;
    };

    // Render Polygons and Polylines
    processedGeoJson.features?.forEach((feat: any) => {
      const geom = feat.geometry;
      const isSelected = selectedFeature && selectedFeature.id === feat.id;
      const isHovered = hoveredFeature && hoveredFeature.id === feat.id;

      let fillStyle = 'rgba(45, 212, 191, 0.08)'; // Neon Teal transparent fill
      let strokeStyle = 'rgba(45, 212, 191, 0.45)'; // Neon Teal main stroke
      let lineWidth = 1.5;

      if (feat.properties?.TYPE === 'Waterbody') {
        fillStyle = isSelected ? 'rgba(14, 165, 233, 0.5)' : isHovered ? 'rgba(14, 165, 233, 0.35)' : 'rgba(14, 165, 233, 0.2)';
        strokeStyle = '#0ea5e9';
      } else if (feat.properties?.TYPE?.includes('Road') || feat.properties?.TYPE?.includes('Causeway')) {
        strokeStyle = isSelected ? '#f59e0b' : isHovered ? '#fbbf24' : '#404040';
        lineWidth = 2.5;
      } else {
        if (isSelected) {
          fillStyle = 'rgba(45, 212, 191, 0.35)';
          strokeStyle = '#2dd4bf';
          lineWidth = 2;
        } else if (isHovered) {
          fillStyle = 'rgba(45, 212, 191, 0.18)';
          strokeStyle = '#5eead4';
        }
      }

      if (!geom) return;

      const drawRing = (ring: [number, number][]) => {
        if (ring.length < 1) return;
        ctx.moveTo(projX(ring[0][0]), projY(ring[0][1]));
        for (let idx = 1; idx < ring.length; idx++) {
          ctx.lineTo(projX(ring[idx][0]), projY(ring[idx][1]));
        }
      };

      if (geom.type === 'Polygon') {
        ctx.beginPath();
        geom.coordinates.forEach((ring: [number, number][], ringIdx: number) => {
          drawRing(ring);
          if (ringIdx === 0) {
            ctx.closePath();
          }
        });
        ctx.fillStyle = fillStyle;
        ctx.fill();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach((poly: [number, number][][]) => {
          ctx.beginPath();
          poly.forEach((ring: [number, number][], ringIdx: number) => {
            drawRing(ring);
            if (ringIdx === 0) {
              ctx.closePath();
            }
          });
          ctx.fillStyle = fillStyle;
          ctx.fill();
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        });
      } else if (geom.type === 'LineString') {
        ctx.beginPath();
        drawRing(geom.coordinates);
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      } else if (geom.type === 'MultiLineString') {
        geom.coordinates.forEach((line: [number, number][]) => {
          ctx.beginPath();
          drawRing(line);
          ctx.strokeStyle = strokeStyle;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        });
      } else if (geom.type === 'Point') {
        // Points visual styling
        const px = projX(geom.coordinates[0]);
        const py = projY(geom.coordinates[1]);

        ctx.beginPath();
        ctx.arc(px, py, isSelected ? 8 : isHovered ? 6 : 4, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? '#f59e0b' : '#2dd4bf';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        // Render point text label dynamically
        if (feat.properties?.NAME) {
          ctx.font = '10px var(--font-sans)';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText(feat.properties.NAME, px + 10, py + 3);
        }
      }
    });
  }

  // Handle Resize of drawing area
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && canvasRef.current.parentElement) {
        setCanvasSize({
          width: canvasRef.current.parentElement.clientWidth,
          height: Math.max(380, canvasRef.current.parentElement.clientHeight - 40)
        });
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [originalGeoJson]);

  // Trigger processedGeoJson recalculation when parameters change
  useEffect(() => {
    if (!originalGeoJson) return;
    const timer = setTimeout(() => {
      processMapData();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalGeoJson, simplifyValue, precisionValue, enableGcj02, selectedProperties, selectedProjection, customProj4Str]);

  // Drawing Loop
  useEffect(() => {
    drawMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedGeoJson, canvasSize, zoom, panX, panY, hoveredFeature, selectedFeature]);



  // Convert File Size Bytes to Human Readable KB / MB
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const idx = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, idx)).toFixed(2)) + ' ' + sizes[idx];
  };

  // Download converted GeoJSON action
  const handleDownloadGeoJSON = () => {
    if (!processedGeoJson) return;

    const dataStr = JSON.stringify(processedGeoJson, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/geo+json;charset=utf-8;' });
    const url = URL.createObjectURL(dataBlob);

    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.setAttribute('download', `${loadedFileName || 'converted'}_gcj02.json`);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // Export processed attributes as a CSV file
  const handleDownloadCSV = () => {
    if (!processedGeoJson || !processedGeoJson.features || processedGeoJson.features.length === 0) return;

    // Collect all property keys
    const allKeysSet = new Set<string>();
    processedGeoJson.features.forEach((feat: any) => {
      if (feat.properties) {
        Object.keys(feat.properties).forEach(k => allKeysSet.add(k));
      }
    });
    const propertyKeys = Array.from(allKeysSet);

    // Columns: ID, GeometryType, plus each key
    const headers = ["ID", "GeometryType", ...propertyKeys];

    // Helper to escape CSV cell values
    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [headers.join(',')];

    processedGeoJson.features.forEach((feat: any, idx: number) => {
      const featId = feat.id !== undefined ? String(feat.id) : `Feature_${idx + 1}`;
      const geomType = feat.geometry ? feat.geometry.type : 'Unknown';
      const rowData = [escapeCSV(featId), escapeCSV(geomType)];

      propertyKeys.forEach((key) => {
        const val = feat.properties ? feat.properties[key] : '';
        rowData.push(escapeCSV(val));
      });

      rows.push(rowData.join(','));
    });

    const csvContent = rows.join('\n');
    const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(dataBlob);

    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.setAttribute('download', `${loadedFileName || 'converted'}_attributes.csv`);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // Export geometries and attributes as a KML file
  const handleDownloadKML = () => {
    if (!processedGeoJson || !processedGeoJson.features) return;

    let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${loadedFileName || 'converted'}</name>
    <description>Generated by GEO-TRANSFORM (GCJ-02 converted mapping)</description>
    <Style id="polygon_style">
      <LineStyle>
        <color>ff00ff00</color> <!-- Green outline -->
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>4000ff00</color> <!-- Semi-transparent green fill -->
      </PolyStyle>
    </Style>
    <Style id="linestring_style">
      <LineStyle>
        <color>ff0000ff</color> <!-- Blue -->
        <width>3</width>
      </LineStyle>
    </Style>
    <Style id="point_style">
      <IconStyle>
        <color>ffff0000</color> <!-- Red Icon -->
        <scale>1.1</scale>
      </IconStyle>
    </Style>
`;

    // Map feature geometry to KML tags
    const formatCoordinates = (coords: [number, number][]): string => {
      return coords.map(pt => `${pt[0]},${pt[1]},0`).join(' ');
    };

    const convertGeometryToKML = (geom: any): string => {
      if (!geom) return '';
      const type = geom.type;
      const coords = geom.coordinates;

      switch (type) {
        case 'Point':
          return `      <Point>
        <coordinates>${coords[0]},${coords[1]},0</coordinates>
      </Point>`;
        case 'LineString':
          return `      <LineString>
        <coordinates>${formatCoordinates(coords)}</coordinates>
      </LineString>`;
        case 'Polygon':
          return `      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${formatCoordinates(coords[0])}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
        ${coords.slice(1).map((ring: any) => `        <innerBoundaryIs>
          <LinearRing>
            <coordinates>${formatCoordinates(ring)}</coordinates>
          </LinearRing>
        </innerBoundaryIs>`).join('\n')}
      </Polygon>`;
        case 'MultiPoint':
          return `      <MultiGeometry>
        ${coords.map((pt: any) => `        <Point>
          <coordinates>${pt[0]},${pt[1]},0</coordinates>
        </Point>`).join('\n')}
      </MultiGeometry>`;
        case 'MultiLineString':
          return `      <MultiGeometry>
        ${coords.map((line: any) => `        <LineString>
          <coordinates>${formatCoordinates(line)}</coordinates>
        </LineString>`).join('\n')}
      </MultiGeometry>`;
        case 'MultiPolygon':
          return `      <MultiGeometry>
        ${coords.map((poly: any) => `        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${formatCoordinates(poly[0])}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
          ${poly.slice(1).map((ring: any) => `          <innerBoundaryIs>
            <LinearRing>
              <coordinates>${formatCoordinates(ring)}</coordinates>
            </LinearRing>
          </innerBoundaryIs>`).join('\n')}
        </Polygon>`).join('\n')}
      </MultiGeometry>`;
        default:
          return '';
      }
    };

    processedGeoJson.features.forEach((feat: any, idx: number) => {
      const featId = feat.id !== undefined ? String(feat.id) : `Feature_${idx + 1}`;
      
      // Try to find a nice human label
      const nameVal = feat.properties 
        ? (feat.properties.name || feat.properties.NAME || feat.properties.title || feat.properties.TITLE || `要素 #${idx + 1}`)
        : `要素 #${idx + 1}`;

      // Build CDATA description of all attributes
      let descTable = '<table border="1" style="border-collapse:collapse; font-family:sans-serif; font-size:12px; width:100%; border-color:#ccc; padding:4px;">';
      descTable += `<tr style="background-color:#eee;"><th>属性名</th><th>属性内容值</th></tr>`;
      if (feat.properties) {
        Object.keys(feat.properties).forEach(key => {
          descTable += `<tr><td style="padding:4px; font-weight:bold;">${key}</td><td style="padding:4px;">${String(feat.properties[key])}</td></tr>`;
        });
      }
      descTable += '</table>';

      // Pick style url based on geometry type
      const geomType = feat.geometry ? feat.geometry.type : '';
      let styleUrl = '';
      if (geomType.includes('Polygon')) styleUrl = '#polygon_style';
      else if (geomType.includes('Line')) styleUrl = '#linestring_style';
      else if (geomType.includes('Point')) styleUrl = '#point_style';

      const geomKML = convertGeometryToKML(feat.geometry);

      if (geomKML) {
        kmlContent += `    <Placemark>
      <name><![CDATA[${nameVal}]]></name>
      <description><![CDATA[${descTable}]]></description>
      ${styleUrl ? `<styleUrl>${styleUrl}</styleUrl>` : ''}
${geomKML}
    </Placemark>
`;
      }
    });

    kmlContent += `  </Document>
</kml>`;

    const dataBlob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8;' });
    const url = URL.createObjectURL(dataBlob);

    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.setAttribute('download', `${loadedFileName || 'converted'}_gcj02.kml`);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  // Multi file checkbox attribute state switcher
  const handleToggleProperty = (propKey: string) => {
    if (selectedProperties.includes(propKey)) {
      setSelectedProperties(prev => prev.filter(p => p !== propKey));
    } else {
      setSelectedProperties(prev => [...prev, propKey]);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-slate-300 flex flex-col" id="app_root">
      {/* Premium Elegant Header */}
      <header className="border-b border-[#1A1A1A] bg-[#0D0D0D] sticky top-0 z-40 px-6 py-4 flex flex-wrap items-center justify-between" id="app_header">
        <div className="flex items-center space-x-3">
          <div className="bg-[#2DD4BF] text-black font-bold p-2.5 rounded-lg flex items-center justify-center shadow-md">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-display font-medium text-white tracking-tight flex items-center gap-2">
              GEO-TRANSFORM <span className="text-slate-500 font-light italic text-xs">v2.4.0</span>
            </h1>
            <p className="text-xs text-[#2DD4BF] font-mono tracking-wider">
              Shapefile ⇄  GeoJSON (GCJ-02) 转换压缩工具
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4 mt-4 sm:mt-0">
          <div className="hidden md:flex items-center gap-4 text-xs tracking-widest uppercase font-mono mr-2">
            <span className="text-[#2DD4BF]">● System Ready</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-500">Offline Projections</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-6 flex flex-col lg:flex-row gap-6">

        {/* Column 1: Config Parameters */}
        <div className="w-full lg:w-[410px] space-y-6 flex-shrink-0" id="parameters_panel">

          {/* Card: File Dropper Selector */}
          <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded-lg p-5 space-y-4">
            <h2 className="text-xs uppercase tracking-[0.15em] font-semibold text-white flex items-center gap-2">
              <FileUp className="h-4 w-4 text-[#2DD4BF]" />
              1. 载入原始 Shapefile 数据
            </h2>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) {
                  handleUploadedFiles(Array.from(e.dataTransfer.files));
                }
              }}
              className="border border-dashed border-[#262626] hover:border-[#2DD4BF] rounded-lg p-6 text-center cursor-pointer bg-[#141414]/30 hover:bg-[#141414]/65 transition relative group"
              onClick={() => {
                const el = document.getElementById('shp_file_picker');
                if (el) el.click();
              }}
            >
              <input
                id="shp_file_picker"
                type="file"
                multiple
                accept=".shp,.prj,.dbf,.shx,.cpg,.zip"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                     handleUploadedFiles(Array.from(e.target.files));
                  }
                }}
              />
              <div className="flex flex-col items-center space-y-2.5">
                <div className="p-3 bg-black rounded-lg border border-[#262626] shadow-sm group-hover:scale-105 transition">
                  <FileCheck2 className="h-6 w-6 text-slate-500 group-hover:text-[#2DD4BF]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-300">拖拽上传或点击浏览</p>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                    支持单件 ZIP 压缩包，或多选一次性置入 <br />
                    <span className="font-mono bg-black/40 text-[#2DD4BF] border border-[#262626] px-1.5 py-0.5 rounded mr-1">.shp</span>
                    <span className="font-mono bg-black/40 text-[#2DD4BF] border border-[#262626] px-1.5 py-0.5 rounded mr-1">.dbf</span>
                    <span className="font-mono bg-black/40 text-[#2DD4BF] border border-[#262626] px-1.5 py-0.5 rounded mr-1">.prj</span>
                    <span className="font-mono bg-black/40 text-[#2DD4BF] border border-[#262626] px-1.5 py-0.5 rounded">.shx</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Error view */}
            {parseError && (
              <div className="p-3 bg-red-950/20 text-red-400 text-xs rounded-lg border border-red-900/40 flex items-start gap-2 animate-fadeIn">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-500" />
                <div>
                  <p className="font-semibold">文件读取受阻</p>
                  <p className="mt-0.5 leading-relaxed opacity-90">{parseError}</p>
                </div>
              </div>
            )}

            {/* File List status tracker */}
            {uploadedFiles.length > 0 && (
              <div className="bg-[#141414] rounded-lg p-3 border border-[#262626] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em]">上传文件组</p>
                  <span className="text-[10px] bg-black border border-[#262626] font-mono px-1.5 py-0.5 rounded text-[#2DD4BF]">
                    {loadedFileName}
                  </span>
                </div>
                <div className="space-y-1 max-h-[140px] overflow-y-auto">
                  {uploadedFiles.map((file, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-[#1A1A1A] last:border-0 font-mono">
                      <span className="text-slate-300 truncate max-w-[200px]">{file.name}</span>
                      <span className="text-slate-500 text-[10px]">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* GIS Converter Parameter Tuning Panel */}
          <div className={`bg-[#0D0D0D] border border-[#1A1A1A] rounded-lg p-5 space-y-6 ${!originalGeoJson ? 'opacity-40 pointer-events-none select-none transition' : 'transition'}`}>
            <h2 className="text-xs uppercase tracking-[0.15em] font-semibold text-white flex items-center gap-2">
              <Sliders className="h-4 w-4 text-[#2DD4BF]" />
              2. 地图输出与压缩参数
            </h2>

            {/* A: Proj4 re-projection setting */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  源数据投影 (CRS)
                </label>
                <span className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]" title={detectedCRS}>
                  {detectedCRS}
                </span>
              </div>
              <select
                value={selectedProjection}
                onChange={(e) => {
                  setSelectedProjection(e.target.value);
                  if (e.target.value !== 'custom') setCustomProj4Str('');
                }}
                className="w-full bg-[#141414] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#2DD4BF] outline-none text-slate-300 font-sans cursor-pointer"
              >
                {EPSG_PRESETS.map((p) => (
                  <option key={p.code} value={p.code}>{p.code} - {p.name}</option>
                ))}
                <option value="custom">⚙️ 自定义 Proj4 字符串</option>
              </select>

              {selectedProjection === 'custom' && (
                <div className="mt-2 animate-fadeIn">
                  <input
                    type="text"
                    value={customProj4Str}
                    onChange={(e) => setCustomProj4Str(e.target.value)}
                    placeholder="输入 +proj=utm +zone=50... 字符串"
                    className="w-full bg-[#141414] border border-[#262626] rounded-lg px-3 py-2 text-xs focus:border-[#2DD4BF] font-mono placeholder-slate-650 text-slate-300 outline-none"
                  />
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                    您可以从 epsg.io 上搜索对应的 Proj4 格式文本复制过来。
                  </p>
                </div>
              )}
            </div>

            {/* B: GCJ-02 Chinese Offset Corrector */}
            <div className="bg-[#2DD4BF]/5 rounded-lg p-3.5 border border-[#2DD4BF]/15 flex items-start space-x-3">
              <input
                id="toggle_gcj02"
                type="checkbox"
                checked={enableGcj02}
                onChange={(e) => setEnableGcj02(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-[#262626] bg-black text-[#2DD4BF] accent-[#2DD4BF] focus:ring-[#2DD4BF] cursor-pointer"
              />
              <div>
                <label htmlFor="toggle_gcj02" className="text-xs font-semibold text-white cursor-pointer flex items-center gap-1 select-none">
                  重新投影至 GCJ-02 (火星坐标系)
                </label>
                <p className="text-[11px] text-[#2DD4BF]/80 mt-1 leading-relaxed">
                  主流国内Web及移动端地图强制使用火星坐标。纠偏后，能够完美贴合国内街道路网，拒绝飘移。
                </p>
              </div>
            </div>

            {/* C: Douglas Peucker slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-300">几何节点简化 (DP 算法)</label>
                  <p className="text-[10px] text-slate-500 mt-0.5">Douglas-Peucker 阀值</p>
                </div>
                <span className="text-xs font-semibold bg-[#141414] border border-[#262626] font-mono px-2 py-0.5 rounded text-[#2DD4BF]">
                  {simplifyValue === 0 ? '无简化' : `${simplifyValue}%`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={simplifyValue}
                onChange={(e) => setSimplifyValue(parseInt(e.target.value))}
                className="w-full accent-[#2DD4BF] cursor-pointer bg-[#1A1A1A] h-1 rounded-lg"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>0% (高精高占用)</span>
                <span>50% (推荐比例)</span>
                <span>100% (极简骨架)</span>
              </div>
            </div>

            {/* D: coordinate rounding precision */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-300">坐标小数位截断</label>
                  <p className="text-[10px] text-slate-500 mt-0.5">缩减多余文本开支</p>
                </div>
                <span className="text-xs font-semibold bg-[#141414] border border-[#262626] font-mono px-2 py-0.5 rounded text-[#2DD4BF]">
                  {precisionValue} 位小数
                </span>
              </div>
              <input
                type="range"
                min="3"
                max="14"
                value={precisionValue}
                onChange={(e) => setPrecisionValue(parseInt(e.target.value))}
                className="w-full accent-[#2DD4BF] cursor-pointer bg-[#1A1A1A] h-1 rounded-lg"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>3位 (~110米级)</span>
                <span>6位 (标准精度 11cm级)</span>
                <span>14位 (完整精度)</span>
              </div>
            </div>

            {/* E: Attribute column filtering */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-semibold text-slate-300">保留业务属性字段 (DBF)</label>
                  <p className="text-[10px] text-slate-500 mt-0.5">未勾选的属性将被强行剪除</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedProperties.length === allProperties.length) {
                      setSelectedProperties([]);
                    } else {
                      setSelectedProperties([...allProperties]);
                    }
                  }}
                  className="text-[10px] font-semibold text-[#2DD4BF] hover:text-[#2DD4BF]/80 hover:underline cursor-pointer"
                >
                  {selectedProperties.length === allProperties.length ? '全消' : '全选'}
                </button>
              </div>

              {allProperties.length === 0 ? (
                <div className="text-center py-6 bg-black/40 border border-dashed border-[#262626] rounded-lg">
                  <p className="text-xs text-slate-500">尚无要素属性，搭载 .dbf 即可显示</p>
                </div>
              ) : (
                <div className="border border-[#262626] rounded-lg max-h-[160px] overflow-y-auto bg-black/40 divide-y divide-[#1A1A1A] pr-1 select-none">
                  {allProperties.map((propName) => (
                    <div key={propName} className="flex items-center py-2.5 px-3 text-xs justify-between group">
                      <div className="flex items-center space-x-2">
                        <input
                          id={`prop_chbox_${propName}`}
                          type="checkbox"
                          checked={selectedProperties.includes(propName)}
                          onChange={() => handleToggleProperty(propName)}
                          className="h-3.5 w-3.5 rounded border-[#262626] bg-black text-[#2DD4BF] accent-[#2DD4BF] focus:ring-[#2DD4BF] cursor-pointer"
                        />
                        <label htmlFor={`prop_chbox_${propName}`} className="font-medium text-slate-300 font-mono cursor-pointer truncate max-w-[170px]">
                          {propName}
                        </label>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono truncate max-w-[110px]" title={String(propertySamples[propName])}>
                        {propertySamples[propName] !== undefined ? `例: ${String(propertySamples[propName]).substring(0, 16)}` : '空值'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Column 2: Live View & Diagnostic Reports */}
        <div className="flex-1 min-w-0 space-y-6 flex flex-col" id="output_panel">

          {/* Row: Global size analysis KPI */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="stats_counters">
            <div className="bg-[#0D0D0D] border border-[#1A1A1A] p-4 rounded-lg flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium">原始文件体积</p>
                <p className="text-xl font-mono font-semibold text-white mt-1">
                  {originalGeoJson ? formatBytes(origStats.size) : '0.00 KB'}
                </p>
              </div>
              <div className="h-10 w-10 bg-black border border-[#262626] rounded flex items-center justify-center text-slate-500 font-mono font-bold text-xs uppercase" title="Original File Size">
                Orig
              </div>
            </div>

            <div className="bg-[#0D0D0D] border border-[#1A1A1A] p-4 rounded-[#101010] flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium font-sans">压缩出炉体积（GeoJSON）</p>
                <p className="text-xl font-mono font-semibold text-[#2DD4BF] mt-1">
                  {originalGeoJson ? formatBytes(procStats.size) : '0.00 KB'}
                </p>
              </div>
              {originalGeoJson && (
                <div className="bg-[#2DD4BF]/15 border border-[#2DD4BF]/20 text-[#2DD4BF] font-mono text-xs font-semibold px-2 py-0.5 rounded">
                  -{((1 - procStats.size / Math.max(origStats.size, 1)) * 100).toFixed(1)}%
                </div>
              )}
            </div>

            <div className="bg-[#0D0D0D] border border-[#1A1A1A] p-4 rounded-lg flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium font-sans">要素与节点数折损</p>
                <div className="mt-1.5 flex flex-col gap-1 text-xs font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-550">要素数:</span>
                    <span className="text-slate-400">{origStats.features}</span>
                    <ChevronRight className="h-3 w-3 text-slate-600" />
                    <span className="text-[#2DD4BF] font-bold">{procStats.features}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-550">节点数:</span>
                    <span className="text-slate-500 line-through">{origStats.vertices}</span>
                    <ChevronRight className="h-3 w-3 text-slate-600" />
                    <span className="text-[#2DD4BF] font-bold">{procStats.vertices}</span>
                  </div>
                </div>
              </div>
              {originalGeoJson && origStats.vertices > 0 && (
                <div className="bg-[#2DD4BF]/10 border border-[#2DD4BF]/15 text-[#2DD4BF] font-mono text-[10px] px-2 py-1 rounded text-center flex flex-col items-center justify-center leading-tight">
                  <span className="text-[9px] opacity-80 font-sans">节点扣减</span>
                  <span className="text-[11px] font-bold">-{((1 - procStats.vertices / origStats.vertices) * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Top Row: Attribute Inspector */}
          <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded-lg p-4 mb-6 relative">
            <div className="border-[#1A1A1A] border-b pb-3 mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Layers className="h-4 w-4 text-[#2DD4BF]" />
                <span className="text-xs font-bold text-white uppercase tracking-[0.1em]">要素属性检视 (Attribute Inspector)</span>
              </div>
            </div>

            <div className="animate-fadeIn">
              {selectedFeature ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#262626] pb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-[#2DD4BF]" />
                      要素识别详情 ({selectedFeature.id || '未知ID'})
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedFeature(null)}
                      className="text-[10px] bg-black border border-[#262626] hover:bg-[#1C1C1C] px-2 py-1 rounded text-slate-300 cursor-pointer transition animate-none"
                    >
                      取消选中
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 font-mono text-xs max-h-[160px] overflow-y-auto scrollbar-thin pr-1">
                    {Object.keys(selectedFeature.properties || {}).map((k) => (
                      <div key={k} className="flex justify-between py-1.5 px-2 bg-[#141414] border border-[#1F1F1F] rounded gap-2 overflow-hidden items-center">
                        <span className="text-slate-450 font-medium truncate shrink-0 max-w-[124px]" title={k}>{k}:</span>
                        <span className="text-slate-200 font-semibold truncate text-right shrink" title={String(selectedFeature.properties[k])}>{String(selectedFeature.properties[k])}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-[#2DD4BF]/5 border border-[#2DD4BF]/10 rounded p-2.5 text-xs text-slate-300">
                    <p className="leading-relaxed text-slate-400 text-[11px]">
                      💡 <span className="font-semibold text-[#2DD4BF]">提示：</span>
                      当前要素包含 <span className="text-[#2DD4BF] font-mono font-bold">{countVertices(selectedFeature)}</span> 个折线/多边形节点。在前端 Web 渲染或 GIS 系统中，您可以直接将该坐标数组或导出的 GeoJSON 载入以进行高性能矢量渲染与图层叠加。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-center">
                  <Layers className="h-8 w-8 text-[#262626] mx-auto mb-2 animate-pulse" />
                  <h4 className="text-xs font-bold text-slate-400">未选中任何要素</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-[360px] mx-auto">
                    请在下方交互预览区域中点击要素或地块。点击后此面板将分栏平铺展示其全部字段属性。
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Full Width Vector Preview Canvas */}
          <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded-lg p-4 flex flex-col min-h-[480px] relative">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <div className="bg-[#2DD4BF]/10 text-[#2DD4BF] p-1.5 rounded">
                  <Layers className="h-4 w-4" />
                </div>
                <span className="text-xs font-bold text-white uppercase tracking-[0.1em]">交互折线/多边形矢量预览 (HTML5 Live Canvas)</span>
              </div>

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => { setZoom(prev => Math.min(prev * 1.25, 150)); }}
                  className="p-1 px-2 border border-[#262626] hover:bg-[#141414] rounded text-slate-400 transition text-xs shadow-sm flex items-center gap-1 bg-black/40 cursor-pointer"
                  title="放大"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setZoom(prev => Math.max(prev / 1.25, 0.4)); }}
                  className="p-1 px-2 border border-[#262626] hover:bg-[#141414] rounded text-slate-400 transition text-xs shadow-sm flex items-center gap-1 bg-black/40 cursor-pointer"
                  title="缩小"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setPanX(0); setPanY(0); setZoom(1); }}
                  className="p-1.5 border border-[#262626] hover:bg-[#141414] rounded text-slate-400 transition shadow-sm bg-black/40 cursor-pointer"
                  title="重置视图"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {processedGeoJson ? (
              <div className="relative flex-1 bg-[#070707] rounded overflow-hidden border border-[#1C1C1C] shadow-inner group min-h-[420px]">
                <canvas
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={() => {
                    if (isDraggingRef.current) {
                      isDraggingRef.current = false;
                      setIsDragging(false);
                      if (Math.abs(velocityRef.current.x) > 0.5 || Math.abs(velocityRef.current.y) > 0.5) {
                        startInertia();
                      }
                    }
                    setHoveredFeature(null);
                  }}
                  onWheel={handleCanvasWheel}
                  className="w-full h-full block cursor-grab active:cursor-grabbing"
                  id="map_visualizer_canvas"
                />

                {/* Dynamic Gesture Feedback HUD */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none z-10 select-none">
                  {isDragging && (
                    <div className="bg-[#2DD4BF] text-black font-semibold text-[10px] px-3 py-1 rounded-full shadow-lg border border-[#2DD4BF]/20 flex items-center gap-1.5 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping" />
                      ✥ 正在平移 (X: {Math.round(panX)} | Y: {Math.round(panY)})
                    </div>
                  )}
                  {showZoomHUD && !isDragging && (
                    <div className="bg-black/90 text-[#2DD4BF] font-mono text-[10px] px-3 py-1 rounded-full shadow-lg border border-[#2DD4BF]/30 flex items-center gap-1.5">
                      <span className="text-slate-400">缩放倍率:</span>
                      <span className="font-bold">{(zoom * 100).toFixed(0)}%</span>
                    </div>
                  )}
                </div>

                {/* Lat Lng status marker */}
                {inspectCoordinates && (
                  <div className="absolute bottom-3 left-3 bg-[#0D0D0D]/90 text-slate-300 font-mono text-[10px] px-2 py-1 rounded border border-[#262626] pointer-events-none shadow">
                    经度: {inspectCoordinates[0].toFixed(6)}° | 纬度: {inspectCoordinates[1].toFixed(6)}°
                  </div>
                )}

                {/* Simple canvas navigation indicator */}
                <div className="absolute top-3 right-3 bg-[#0D0D0D]/90 text-slate-400 text-[10px] px-2.5 py-1 rounded border border-[#262626] pointer-events-none flex items-center gap-1.5 select-none opacity-0 group-hover:opacity-100 transition duration-300">
                  <Info className="h-3 w-3 text-[#2DD4BF]" />
                  <span>滚轮缩放 / 鼠标左键拖拽平移 / 点击多边形查看属性</span>
                </div>

                {/* Float Attribute hover inspection popup */}
                {hoveredFeature && (
                  <div className="absolute top-3 left-3 bg-black/90 text-slate-300 p-2.5 rounded border border-[#262626] pointer-events-none shadow-xl max-w-[240px] animate-fadeIn text-[11px] leading-tight space-y-1">
                    <div className="flex items-center gap-1.5 text-[#2DD4BF] border-b border-[#262626] pb-1 font-semibold mb-1">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{hoveredFeature.properties?.NAME || '地块要素'}</span>
                    </div>
                    <div className="space-y-0.5 max-h-[120px] overflow-y-auto font-mono scrollbar-thin">
                      {Object.keys(hoveredFeature.properties || {}).map(key => (
                        <div key={key} className="flex items-start justify-between gap-2 py-0.5">
                          <span className="text-slate-550 font-medium text-[9px]">{key}:</span>
                          <span className="text-slate-300 truncate">{String(hoveredFeature.properties[key])}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 bg-black/40 rounded-lg flex flex-col items-center justify-center text-center p-6 border border-[#262626] shadow-inner min-h-[380px]">
                <div className="h-12 w-12 bg-[#141414] border border-[#262626] rounded-full flex items-center justify-center mb-3">
                  <Layers className="h-6 w-6 text-slate-600 animate-pulse" />
                </div>
                <p className="text-sm font-semibold text-slate-300">暂无几何图层地图</p>
                <p className="text-xs text-slate-500 mt-1.5 max-w-[280px]">
                  请在左侧面板中选择并载入您的 Shapefile 文件集（.shp & .dbf 等）以开始转换和精细预览。
                </p>
              </div>
            )}

            {/* Download CTA Float Bottom Card with multi-format export flexibility */}
            {processedGeoJson && (
              <div className="mt-4 bg-[#141414] border border-[#262626] p-4 rounded flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 animate-fadeIn">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-[#2DD4BF] flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-white">转换成功 & 导出就绪</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">支持导出坐标校正后的矢量以及整理后的属性属性表</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
                  <button
                    onClick={handleDownloadGeoJSON}
                    className="flex-1 sm:flex-initial bg-[#2DD4BF] hover:bg-[#2DD4BF]/90 text-black px-3 py-2 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer border-0 shadow-md"
                    id="btn_download_geojson"
                    title="下载转换后的 GeoJSON 格式"
                  >
                    <Download className="h-3.5 w-3.5" />
                    GeoJSON 矢量
                  </button>

                  <button
                    onClick={handleDownloadKML}
                    className="flex-1 sm:flex-initial bg-[#0F1E1B] hover:bg-[#1A332E] text-[#2DD4BF] border border-[#2DD4BF]/30 hover:border-[#2DD4BF]/50 px-3 py-2 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                    id="btn_download_kml"
                    title="导出适用于 Google Earth / GIS 软件的 KML 格式"
                  >
                    <Download className="h-3.5 w-3.5" />
                    KML 格式
                  </button>

                  <button
                    onClick={handleDownloadCSV}
                    className="flex-1 sm:flex-initial bg-[#1A1A1A] hover:bg-[#262626] text-slate-200 border border-slate-700 hover:border-slate-600 px-3 py-2 rounded text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                    id="btn_download_csv"
                    title="导出要素属性表为标准 CSV 内容"
                  >
                    <Download className="h-3.5 w-3.5" />
                    CSV 属性表
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>



      {/* Footer footer */}
      <footer className="border-t border-[#1A1A1A] py-6 px-6 text-center text-[11px] text-slate-600 bg-black">
        <p>© 2026 Shapefile-to-GeoJSON Map Compressor. Powered by Google AI Studio Gemini-3.5-flash & Proj4 Client Library.</p>
      </footer>
    </div>
  );
}
