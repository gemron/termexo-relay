import {
  AfterViewInit,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  Renderer2,
  viewChild,
} from '@angular/core';
import {
  CircleGauge,
  History,
  KeyRound,
  MonitorSmartphone,
  Server,
  ShieldCheck,
  Square,
  Users,
  X,
  type IconNode,
} from 'lucide';

/**
 * The line icons the console draws, under the names its templates use.
 *
 * Only the icons actually rendered are listed: `lucide` is tree-shaken per import, so an unused
 * entry here is dead weight in the bundle rather than a spare part.
 */
const ICONS: Record<string, IconNode> = {
  devices: MonitorSmartphone,
  gauge: CircleGauge,
  history: History,
  key: KeyRound,
  server: Server,
  shield: ShieldCheck,
  users: Users,
  x: X,
};

/** Drawn when a name is not in the table, so a typo shows as an empty box instead of nothing. */
const UNKNOWN_ICON: IconNode = Square;

@Component({
  selector: 'app-icon',
  template: '<svg #svg aria-hidden="true" style="display: block; width: 100%; height: 100%"></svg>',
  host: {
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    style:
      'display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; line-height: 0; vertical-align: middle;',
  },
})
export class IconComponent implements AfterViewInit {
  private readonly renderer = inject(Renderer2);
  private readonly svg = viewChild.required<ElementRef<SVGElement>>('svg');

  readonly name = input.required<string>();
  readonly size = input(16);
  readonly strokeWidth = input(1.8);
  private viewReady = false;

  constructor() {
    effect(() => {
      const name = this.name();
      const size = this.size();
      const strokeWidth = this.strokeWidth();
      if (this.viewReady) {
        this.renderIcon(name, size, strokeWidth);
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderIcon(this.name(), this.size(), this.strokeWidth());
  }

  private renderIcon(name: string, size: number, strokeWidth: number): void {
    const svg = this.svg().nativeElement;
    const iconNode = ICONS[name] ?? UNKNOWN_ICON;
    while (svg.firstChild) {
      this.renderer.removeChild(svg, svg.firstChild);
    }
    this.renderer.setAttribute(svg, 'width', String(size));
    this.renderer.setAttribute(svg, 'height', String(size));
    this.renderer.setAttribute(svg, 'viewBox', '0 0 24 24');
    this.renderer.setAttribute(svg, 'fill', 'none');
    this.renderer.setAttribute(svg, 'stroke', 'currentColor');
    this.renderer.setAttribute(svg, 'stroke-width', String(strokeWidth));
    this.renderer.setAttribute(svg, 'stroke-linecap', 'round');
    this.renderer.setAttribute(svg, 'stroke-linejoin', 'round');

    for (const [tag, attributes] of iconNode) {
      const child = this.renderer.createElement(tag, 'svg');
      for (const [attribute, value] of Object.entries(attributes)) {
        this.renderer.setAttribute(child, attribute, String(value));
      }
      this.renderer.appendChild(svg, child);
    }
  }
}
