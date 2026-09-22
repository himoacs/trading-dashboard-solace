import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { TopicNode } from '@/lib/topicNode';

// Ported from solace-feed-visualizer's SunburstChart.tsx (itself built against
// the original explorer.solace.dev) - the D3 color engine, arc/icicle
// geometry, zoom and label logic below are kept verbatim. Deliberately NOT
// re-skinned onto this app's shadcn theme tokens: this view keeps its own
// rainbow color wheel and independent light/dark toggle by design, so its
// colors don't get silently controlled by the dashboard's own theme.
//
// `theme` is a prop rather than a context, matching this app's pattern of
// passing connection/display state down rather than introducing a new
// provider for a single feature.

export type SunburstSizingMode = 'equal' | 'messages' | 'bytes' | 'topics';
export type SunburstViewType = 'sunburst' | 'icicle';
export type SunburstTheme = 'light' | 'dark';

interface SunburstChartProps {
  data: TopicNode;
  width?: number;
  height?: number;
  sizingMode?: SunburstSizingMode;
  viewType?: SunburstViewType;
  theme?: SunburstTheme;
  accurateOthersSizes?: boolean;
  onHover?: (node: TopicNode | null) => void;
  onClick?: (node: TopicNode) => void;
  onZoomChange?: (path: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function isInnerTopic(d: d3.HierarchyNode<TopicNode>): boolean {
  return d.data.children.length > 0 && (d.data.ownValue || 0) > 0;
}

function isEmptyLevel(d: d3.HierarchyNode<TopicNode>): boolean {
  return d.data.name === '';
}

export function SunburstChart({
  data,
  width = 600,
  height = 600,
  sizingMode = 'messages',
  viewType = 'sunburst',
  theme = 'dark',
  accurateOthersSizes = false,
  onHover,
  onClick,
  onZoomChange,
}: SunburstChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<TopicNode | null>(null);
  const [hoveredPct, setHoveredPct] = useState<{ level: number; total: number; bytesLevel: number; bytesTotal: number } | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<TopicNode[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [canZoomOut, setCanZoomOut] = useState(false);

  const zoomPathRef = useRef<string>('');
  const zoomOutRef = useRef<() => void>(() => {});

  const radius = Math.min(width, height) / 2.1;

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const centerX = width / 2;
    const centerY = height / 2;

    const g = svg.append('g').attr('transform', viewType === 'sunburst' ? `translate(${centerX},${centerY})` : 'translate(1,1)');

    const getSizeValue = (d: TopicNode): number => {
      if (d.children.length > 0) return 0;
      switch (sizingMode) {
        case 'equal':
          return 1;
        case 'bytes':
          return Math.max(1, d.bytes);
        case 'topics':
          return Math.max(1, d.topicCount || 1);
        case 'messages':
        default:
          return Math.max(1, d.value);
      }
    };

    const hierarchy = d3.hierarchy<TopicNode>(data).sum(getSizeValue);

    const partition = d3.partition<TopicNode>().size([2 * Math.PI, radius]);

    const root = partition(hierarchy);

    const baseLightness = theme === 'dark' ? 0.66 : 0.55;
    const darkT = theme === 'dark' ? 1 : 0;
    const hueValue = 0;
    const COLOR_WIDTH_REDUCER = 0.5;

    function hueFromFraction(t: number): number {
      const wrapped = (((t + hueValue + 10) % 1) + 1) % 1;
      return d3.hsl(d3.interpolateRainbow(1 - wrapped)).h;
    }

    const nodeColorInfo = new Map<d3.HierarchyRectangularNode<TopicNode>, { hue: number | null; depthFromBranch: number }>();

    function stableChildOrder(children: d3.HierarchyRectangularNode<TopicNode>[]): d3.HierarchyRectangularNode<TopicNode>[] {
      return [...children].sort((a, b) => a.data.name.localeCompare(b.data.name));
    }

    function assignColors(node: d3.HierarchyRectangularNode<TopicNode>, ci: number | null, cw: number, depthFromBranch: number) {
      nodeColorInfo.set(node, { hue: ci === null ? null : hueFromFraction(ci), depthFromBranch });

      const children = node.children;
      if (!children || children.length === 0) return;

      if (ci === null) {
        if (children.length === 1) {
          assignColors(children[0], null, cw, 0);
          return;
        }
      }

      const ordered = stableChildOrder(children);
      const cSize = (ci === null ? 1 : cw) / ordered.length;
      const baseCi = ci === null ? 0 : ci - cw / 2;
      const childCw = cSize * (ordered.length === 1 ? 1 : COLOR_WIDTH_REDUCER);
      ordered.forEach((child, i) => {
        const childCi = baseCi + (i + 0.5) * cSize;
        const childDepthFromBranch = ci === null ? 0 : depthFromBranch + 1;
        assignColors(child, childCi, childCw, childDepthFromBranch);
      });
    }

    assignColors(root, null, 1, 0);

    function lerp(lightValue: number, darkValue: number): number {
      return darkT ? darkValue : lightValue;
    }

    function getColor(d: d3.HierarchyRectangularNode<TopicNode>): string {
      const info = nodeColorInfo.get(d);

      if (!info || info.hue === null) {
        const l = Math.min(1, baseLightness + lerp(0.3, 0.1));
        return d3.hsl(0, 0, l).toString();
      }

      const { hue, depthFromBranch } = info;
      let s = 1.0;
      let l = baseLightness;

      if (depthFromBranch > 0) {
        s += depthFromBranch * lerp(-0.08, -0.1);
        l += depthFromBranch * lerp(0.12, -0.06);
      }

      if (d.data.isOthers) {
        s = 0.3;
        if (!accurateOthersSizes && sizingMode !== 'equal') {
          s -= 0.15;
        }
      } else if (d.data.isRollup) {
        s += lerp(-0.2, -0.3);
        l += lerp(0.05, -0.05);
      }

      s = Math.max(0, Math.min(1, s));
      l = Math.max(0, Math.min(1, l));
      return d3.hsl(hue, s, l).toString();
    }

    function fillOpacityFor(d: d3.HierarchyRectangularNode<TopicNode>): number {
      return d.data.isOthers ? 0.5 : 0.8;
    }

    function strokeOpacityFor(d: d3.HierarchyRectangularNode<TopicNode>): number {
      return d.data.isOthers ? 0.3 : 0.5;
    }

    function strokeColorFor(d: d3.HierarchyRectangularNode<TopicNode>): string {
      if (isInnerTopic(d) || isEmptyLevel(d)) {
        return theme === 'dark' ? '#ffffff' : '#000000';
      }
      const fill = d3.hsl(getColor(d));
      const delta = d.data.isOthers ? lerp(-0.2, -0.5) : lerp(-0.3, -0.4);
      fill.l = Math.max(0, Math.min(1, fill.l + delta));
      return fill.toString();
    }

    function strokeWidthFor(d: d3.HierarchyRectangularNode<TopicNode>): number {
      return isInnerTopic(d) ? 2 : 1;
    }

    function strokeDasharrayFor(d: d3.HierarchyRectangularNode<TopicNode>): string {
      return isInnerTopic(d) ? '5,5' : '0';
    }

    root.each((d) => {
      (d as any).x0Orig = d.x0;
      (d as any).x1Orig = d.x1;
      (d as any).y0Orig = d.y0;
      (d as any).y1Orig = d.y1;
    });

    const arc = d3
      .arc<d3.HierarchyRectangularNode<TopicNode>>()
      .startAngle((d) => (d as any).x0Current ?? d.x0)
      .endAngle((d) => (d as any).x1Current ?? d.x1)
      .padAngle((d) => Math.min(((d as any).x1Current ?? d.x1) - ((d as any).x0Current ?? d.x0), 0.005) / 2)
      .padRadius(radius / 2)
      .innerRadius((d) => (d as any).y0Current ?? d.y0)
      .outerRadius((d) => Math.max((d as any).y0Current ?? d.y0, ((d as any).y1Current ?? d.y1) - 1));

    const icicleWidth = width - 2;
    const icicleXScale = d3.scaleLinear().domain([0, 2 * Math.PI]).range([0, icicleWidth]);
    const icicleYScale = d3.scaleLinear().domain([0, radius]).range([0, height - 2]);
    const ICICLE_GAP = 1.5;

    function rectX(d: any): number {
      return icicleXScale(d.x0Current ?? d.x0);
    }
    function rectWidth(d: any): number {
      return Math.max(0, icicleXScale(d.x1Current ?? d.x1) - icicleXScale(d.x0Current ?? d.x0) - ICICLE_GAP);
    }
    function rectY(d: any): number {
      return icicleYScale(d.y0Current ?? d.y0);
    }
    function rectHeight(d: any): number {
      return Math.max(0, icicleYScale(d.y1Current ?? d.y1) - icicleYScale(d.y0Current ?? d.y0) - ICICLE_GAP);
    }

    root.each((d) => {
      (d as any).x0Current = d.x0;
      (d as any).x1Current = d.x1;
      (d as any).y0Current = d.y0;
      (d as any).y1Current = d.y1;
    });

    const descendants = root.descendants().filter((d) => d.depth > 0);

    function nodeVisible(d: any): boolean {
      const y1 = d.y1Current ?? d.y1;
      const y0 = d.y0Current ?? d.y0;
      const x1 = d.x1Current ?? d.x1;
      const x0 = d.x0Current ?? d.x0;
      return y1 <= radius && y0 >= 0 && x1 > x0 + 0.001;
    }

    const LABEL_FONT_SIZE_PX = 10;
    const LABEL_CHAR_WIDTH_PX = LABEL_FONT_SIZE_PX * 0.56;
    const LABEL_MIN_CHARS = 2;
    const LABEL_MIN_RING_THICKNESS_PX = 9;
    const LABEL_MIN_RECT_HEIGHT_PX = 12;
    const LABEL_WIDE_THRESHOLD_RAD = 0.19 * 2 * Math.PI;

    function rawLabelName(d: d3.HierarchyRectangularNode<TopicNode>): string {
      return isEmptyLevel(d) ? '*empty*' : d.data.name;
    }

    function truncateToBudget(name: string, budgetChars: number): string {
      if (budgetChars < LABEL_MIN_CHARS) return '';
      if (name.length <= budgetChars) return name;
      return name.slice(0, Math.max(1, budgetChars - 1)) + '…';
    }

    function sunburstLabelText(d: any): string {
      if (!nodeVisible(d)) return '';
      const x0 = d.x0Current ?? d.x0,
        x1 = d.x1Current ?? d.x1;
      const y0 = d.y0Current ?? d.y0,
        y1 = d.y1Current ?? d.y1;
      if (y1 - y0 < LABEL_MIN_RING_THICKNESS_PX) return '';
      const midRadius = (y0 + y1) / 2;
      const arcLength = (x1 - x0) * midRadius;
      return truncateToBudget(rawLabelName(d), Math.floor(arcLength / LABEL_CHAR_WIDTH_PX));
    }

    function icicleLabelText(d: any): string {
      if (!nodeVisible(d)) return '';
      if (rectHeight(d) < LABEL_MIN_RECT_HEIGHT_PX) return '';
      return truncateToBudget(rawLabelName(d), Math.floor((rectWidth(d) - 4) / LABEL_CHAR_WIDTH_PX));
    }

    function labelText(d: any): string {
      return viewType === 'sunburst' ? sunburstLabelText(d) : icicleLabelText(d);
    }

    function sunburstLabelTransform(d: any): string {
      const x0 = d.x0Current ?? d.x0,
        x1 = d.x1Current ?? d.x1;
      const y0 = d.y0Current ?? d.y0,
        y1 = d.y1Current ?? d.y1;
      const mid = (x0 + x1) / 2;
      const degrees = (((mid * 180) / Math.PI) % 360 + 360) % 360;
      const midRadius = (y0 + y1) / 2;
      if (x1 - x0 > LABEL_WIDE_THRESHOLD_RAD) {
        return `rotate(${degrees - 90}) translate(${midRadius},0) rotate(${90 - degrees})`;
      }
      const flip = degrees > 180 ? 180 : 0;
      return `rotate(${degrees - 90}) translate(${midRadius},0) rotate(${flip})`;
    }

    function icicleLabelTransform(d: any): string {
      return `translate(${rectX(d) + rectWidth(d) / 2},${rectY(d) + rectHeight(d) / 2})`;
    }

    function labelTransform(d: any): string {
      return viewType === 'sunburst' ? sunburstLabelTransform(d) : icicleLabelTransform(d);
    }

    function labelOpacityFor(d: d3.HierarchyRectangularNode<TopicNode>): number {
      if (labelText(d) === '') return 0;
      return d.data.isOthers || d.data.isRollup ? 0.7 : 0.9;
    }

    function copyMetrics(d: d3.HierarchyRectangularNode<TopicNode>) {
      const payload = {
        topic: d.data.path || d.data.name,
        numMsgs: d.data.value,
        numBytes: d.data.bytes,
        lastArrivalMs: d.data.lastArrivalMs ?? null,
        lastArrival: d.data.lastArrivalMs ? new Date(d.data.lastArrivalMs).toISOString() : null,
      };
      navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => {
        console.error('Could not copy topic metrics to clipboard');
      });
    }

    let currentZoom: d3.HierarchyRectangularNode<TopicNode> = root;

    function applyGeometry(selection: any, tweened: boolean) {
      if (viewType === 'sunburst') {
        if (tweened) {
          selection.attrTween('d', (d: any) => () => arc(d) || '');
        } else {
          selection.attr('d', (d: any) => arc(d) || '');
        }
      } else if (tweened) {
        selection
          .attrTween('x', (d: any) => () => String(rectX(d)))
          .attrTween('width', (d: any) => () => String(rectWidth(d)))
          .attrTween('y', (d: any) => () => String(rectY(d)))
          .attrTween('height', (d: any) => () => String(rectHeight(d)));
      } else {
        selection.attr('x', rectX).attr('width', rectWidth).attr('y', rectY).attr('height', rectHeight);
      }
      selection
        .attr('fill-opacity', (d: any) => (nodeVisible(d) ? fillOpacityFor(d) : 0))
        .style('pointer-events', (d: any) => (nodeVisible(d) ? 'auto' : 'none'));
    }

    function applyLabelGeometry(selection: any, tweened: boolean) {
      if (tweened) {
        selection
          .attrTween('transform', (d: any) => () => labelTransform(d))
          .textTween((d: any) => () => labelText(d))
          .attrTween('fill-opacity', (d: any) => () => labelOpacityFor(d));
      } else {
        selection
          .attr('transform', (d: any) => labelTransform(d))
          .text((d: any) => labelText(d))
          .attr('fill-opacity', (d: any) => labelOpacityFor(d));
      }
    }

    function zoomTo(target: d3.HierarchyRectangularNode<TopicNode>) {
      currentZoom = target;
      zoomPathRef.current = target.data.path;
      setCanZoomOut(target.depth > 0);
      onZoomChange?.(target.data.path);

      if (target.depth === 0) {
        setCurrentPath('');
      } else {
        const pathParts: string[] = [];
        let curr: d3.HierarchyRectangularNode<TopicNode> | null = target;
        while (curr && curr.depth > 0) {
          pathParts.unshift(curr.data.name);
          curr = curr.parent;
        }
        setCurrentPath(pathParts.join('/'));
      }

      const t = g.transition().duration(600);

      root.each((d) => {
        const x0 = Math.max(0, Math.min(1, (d.x0 - target.x0) / (target.x1 - target.x0))) * 2 * Math.PI;
        const x1 = Math.max(0, Math.min(1, (d.x1 - target.x0) / (target.x1 - target.x0))) * 2 * Math.PI;
        const y0 = Math.max(0, d.y0 - target.y0);
        const y1 = Math.max(0, d.y1 - target.y0);
        (d as any).x0Target = x0;
        (d as any).x1Target = x1;
        (d as any).y0Target = y0;
        (d as any).y1Target = y1;
      });

      const tweened = shapes.transition(t as any).tween('data', (d) => {
        const x0i = d3.interpolate((d as any).x0Current, (d as any).x0Target);
        const x1i = d3.interpolate((d as any).x1Current, (d as any).x1Target);
        const y0i = d3.interpolate((d as any).y0Current, (d as any).y0Target);
        const y1i = d3.interpolate((d as any).y1Current, (d as any).y1Target);
        return (t: number) => {
          (d as any).x0Current = x0i(t);
          (d as any).x1Current = x1i(t);
          (d as any).y0Current = y0i(t);
          (d as any).y1Current = y1i(t);
        };
      });
      applyGeometry(tweened, true);
      applyLabelGeometry(labels.transition(t as any), true);

      if (viewType === 'sunburst') {
        centerText!.transition(t as any).tween('text', function () {
          const self = this as SVGTextElement;
          const start = parseInt(self.textContent?.replace(/\D/g, '') || '0');
          const end = target.value || 0;
          const i = d3.interpolateNumber(start, end);
          return (t: number) => {
            self.textContent = formatNumber(Math.round(i(t)));
          };
        });

        centerLabel!.text(target.depth === 0 ? 'messages' : target.data.name);
        backHint!.transition(t as any).attr('opacity', target.depth > 0 ? 1 : 0);
      }
    }

    zoomOutRef.current = () => {
      if (currentZoom.parent) zoomTo(currentZoom.parent);
    };

    const shapes = g
      .selectAll<SVGPathElement | SVGRectElement, d3.HierarchyRectangularNode<TopicNode>>('.node')
      .data(descendants)
      .join(viewType === 'sunburst' ? 'path' : 'rect')
      .attr('class', 'node')
      .attr('fill', (d) => getColor(d))
      .attr('stroke', (d) => strokeColorFor(d))
      .attr('stroke-width', (d) => strokeWidthFor(d))
      .attr('stroke-opacity', (d) => strokeOpacityFor(d))
      .attr('stroke-dasharray', (d) => strokeDasharrayFor(d))
      .style('cursor', 'pointer')
      .on('mouseenter', function (_event, d) {
        d3.select(this).attr('fill-opacity', 1).attr('stroke-width', strokeWidthFor(d) + 1);

        setHoveredNode(d.data);
        onHover?.(d.data);

        const rootTotalMsgs = data.value || 0;
        const rootTotalBytes = data.bytes || 0;
        const levelTotalMsgs = currentZoom.data.value || 0;
        const levelTotalBytes = currentZoom.data.bytes || 0;
        setHoveredPct({
          level: levelTotalMsgs > 0 ? (d.data.value || 0) / levelTotalMsgs : 0,
          total: rootTotalMsgs > 0 ? (d.data.value || 0) / rootTotalMsgs : 0,
          bytesLevel: levelTotalBytes > 0 ? (d.data.bytes || 0) / levelTotalBytes : 0,
          bytesTotal: rootTotalBytes > 0 ? (d.data.bytes || 0) / rootTotalBytes : 0,
        });

        const ancestors: TopicNode[] = [];
        let curr: d3.HierarchyRectangularNode<TopicNode> | null = d;
        while (curr && curr.depth > 0) {
          ancestors.unshift(curr.data);
          curr = curr.parent;
        }
        setBreadcrumb(ancestors);
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this).attr('fill-opacity', fillOpacityFor(d)).attr('stroke-width', strokeWidthFor(d));

        setHoveredNode(null);
        setHoveredPct(null);
        onHover?.(null);
        setBreadcrumb([]);
      })
      .on('click', function (event, d) {
        event.stopPropagation();
        if ((d.children && d.children.length > 0) || d.data.isRollup) {
          zoomTo(d);
        }
        onClick?.(d.data);
      })
      .on('contextmenu', function (event, d) {
        event.preventDefault();
        copyMetrics(d);
      });

    applyGeometry(shapes, false);

    const labels = g
      .append('g')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .style('user-select', 'none')
      .selectAll<SVGTextElement, d3.HierarchyRectangularNode<TopicNode>>('text')
      .data(descendants)
      .join('text')
      .attr('dy', '0.35em')
      .attr('font-size', `${LABEL_FONT_SIZE_PX}px`)
      .attr('fill', (d) => strokeColorFor(d));

    applyLabelGeometry(labels, false);

    let centerText: d3.Selection<SVGTextElement, unknown, null, undefined> | undefined;
    let centerLabel: d3.Selection<SVGTextElement, unknown, null, undefined> | undefined;
    let backHint: d3.Selection<SVGTextElement, unknown, null, undefined> | undefined;

    if (viewType === 'sunburst') {
      const centerGroup = g.append('g').attr('class', 'center');

      centerGroup
        .append('circle')
        .attr('r', radius * 0.15)
        .attr('fill', theme === 'dark' ? '#0f172a' : '#f8fafc')
        .attr('stroke', '#00c895')
        .attr('stroke-width', 3)
        .style('cursor', 'pointer')
        .on('click', () => {
          if (currentZoom.parent) zoomTo(currentZoom.parent);
        })
        .on('mouseenter', function () {
          if (currentZoom.parent) d3.select(this).attr('stroke-width', 4);
        })
        .on('mouseleave', function () {
          d3.select(this).attr('stroke-width', 3);
        });

      backHint = centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#00c895')
        .attr('font-size', '10px')
        .attr('y', -15)
        .attr('opacity', 0)
        .text('↑ back');

      centerText = centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', theme === 'dark' ? '#e2e8f0' : '#1e293b')
        .attr('font-size', '16px')
        .attr('font-weight', 'bold')
        .attr('y', 2)
        .text(formatNumber(data.value || 0));

      centerLabel = centerGroup
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#94a3b8')
        .attr('font-size', '10px')
        .attr('y', 18)
        .text('messages');
    }

    if (zoomPathRef.current) {
      const targetNode = root.descendants().find((d) => d.data.path === zoomPathRef.current);
      if (targetNode) {
        root.each((d) => {
          const x0 = Math.max(0, Math.min(1, (d.x0 - targetNode.x0) / (targetNode.x1 - targetNode.x0))) * 2 * Math.PI;
          const x1 = Math.max(0, Math.min(1, (d.x1 - targetNode.x0) / (targetNode.x1 - targetNode.x0))) * 2 * Math.PI;
          const y0 = Math.max(0, d.y0 - targetNode.y0);
          const y1 = Math.max(0, d.y1 - targetNode.y0);
          (d as any).x0Current = x0;
          (d as any).x1Current = x1;
          (d as any).y0Current = y0;
          (d as any).y1Current = y1;
        });

        applyGeometry(shapes, false);
        applyLabelGeometry(labels, false);
        currentZoom = targetNode;
        setCanZoomOut(targetNode.depth > 0);
        onZoomChange?.(targetNode.data.path);

        if (viewType === 'sunburst') {
          centerText!.text(formatNumber(targetNode.value || 0));
          centerLabel!.text(targetNode.depth === 0 ? 'messages' : targetNode.data.name);
          backHint!.attr('opacity', targetNode.depth > 0 ? 1 : 0);
        }

        if (targetNode.depth > 0) {
          const pathParts: string[] = [];
          let curr: d3.HierarchyRectangularNode<TopicNode> | null = targetNode;
          while (curr && curr.depth > 0) {
            pathParts.unshift(curr.data.name);
            curr = curr.parent;
          }
          setCurrentPath(pathParts.join('/'));
        }
      }
    }
  }, [data, width, height, radius, sizingMode, viewType, theme, accurateOthersSizes, onHover, onClick, onZoomChange]);

  const isEmpty = !data || data.value === 0;
  const dim = theme === 'dark' ? 'text-gray-500' : 'text-gray-500';
  const panelBg = theme === 'dark' ? 'bg-slate-800/50' : 'bg-gray-100';
  const accent = theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600';
  const strongText = theme === 'dark' ? 'text-white' : 'text-gray-900';

  return (
    <div className="flex flex-col items-center">
      {currentPath && (
        <div className={`mb-2 rounded-lg border border-emerald-500/30 px-3 py-1.5 ${panelBg}`}>
          <span className={`text-sm ${dim}`}>Level: </span>
          <span className={`text-sm font-medium ${accent}`}>{currentPath}</span>
        </div>
      )}

      <div className="mb-2 flex h-14 flex-col items-center justify-center">
        {breadcrumb.length > 0 && hoveredNode ? (
          <>
            <div className={`flex max-w-md items-center gap-1 overflow-hidden rounded-lg px-3 py-1 text-sm ${panelBg}`}>
              <span className={dim}>Topic:</span>
              <span className={`truncate ${accent}`}>
                {breadcrumb.map((n) => n.name).join('/')}
                {(hoveredNode.children.length > 0 || hoveredNode.isRollup) && '/...'}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm">
              <span>
                <span className={dim}>Msgs:</span>{' '}
                <span className={`font-medium ${strongText}`}>{formatNumber(hoveredNode.value || 0)}</span>
                {hoveredPct && (
                  <span className="text-xs text-gray-500">
                    {' '}
                    ({formatPct(hoveredPct.level)} lvl, {formatPct(hoveredPct.total)} tot)
                  </span>
                )}
              </span>
              <span>
                <span className={dim}>Size:</span>{' '}
                <span className={`font-medium ${strongText}`}>{formatBytes(hoveredNode.bytes || 0)}</span>
                {hoveredPct && (
                  <span className="text-xs text-gray-500">
                    {' '}
                    ({formatPct(hoveredPct.bytesLevel)} lvl, {formatPct(hoveredPct.bytesTotal)} tot)
                  </span>
                )}
              </span>
              {!!hoveredNode.topicCount && (
                <span>
                  <span className={dim}>Topics:</span> <span className={`font-medium ${strongText}`}>{formatNumber(hoveredNode.topicCount)}</span>
                </span>
              )}
              {(hoveredNode.children.length > 0 || hoveredNode.isRollup) && <span className={`text-xs ${accent}`}>(click to zoom)</span>}
            </div>
          </>
        ) : (
          <div className={`text-sm ${dim}`}>
            {currentPath
              ? `Click ${viewType === 'sunburst' ? 'segment' : 'block'} to zoom in • Right-click to copy metrics`
              : `Click ${viewType === 'sunburst' ? 'segment' : 'block'} to zoom in • Hover for details • Right-click to copy metrics`}
          </div>
        )}
      </div>

      {viewType === 'icicle' && canZoomOut && (
        <button
          type="button"
          onClick={() => zoomOutRef.current()}
          className="mb-2 rounded-md bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
        >
          ← Back
        </button>
      )}

      <div className="relative" style={{ width, height }}>
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`text-center ${dim}`}>
              <svg className="mx-auto mb-2 h-12 w-12 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <p className="text-sm">No messages yet</p>
            </div>
          </div>
        )}
        <svg ref={svgRef} width={width} height={height} className={isEmpty ? 'opacity-20' : ''} style={{ shapeRendering: 'geometricPrecision' }} />
      </div>
    </div>
  );
}
