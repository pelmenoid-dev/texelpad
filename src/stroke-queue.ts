import type { Brush } from './projection.ts';

export interface StrokeSink {
  dabSteps(x: number, y: number, brush: Brush, grayscale: boolean): Generator<boolean, void>;
}

type Segment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  steps: number;
  next: number;
  brush: Brush;
};

// Input records complete segments immediately. Rendering consumes them in order,
// including every interpolated dab, with a deadline between small paint chunks.
export class StrokeQueue {
  private segments: Segment[] = [];
  private head = 0;
  private last?: { x: number; y: number };
  private dab?: Generator<boolean, void>;

  constructor(private stroke: StrokeSink, private grayscale: boolean) {}

  get pending() { return this.head < this.segments.length; }

  replaceSink(stroke: StrokeSink) {
    this.stroke = stroke;
    // A failed GPU generator may have stopped before accepting this dab.
    // Retry its step while preserving every queued segment and brush snapshot.
    this.dab = undefined;
  }

  add(x: number, y: number, brush: Brush) {
    const last = this.last ?? { x, y };
    const dx = x - last.x, dy = y - last.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    this.segments.push({
      x0: last.x, y0: last.y, x1: x, y1: y,
      steps: Math.max(1, Math.ceil(distance / Math.max(1, brush.size * .2))),
      next: 1,
      brush: { ...brush },
    });
    this.last = { x, y };
  }

  advance(deadline = Infinity) {
    let changed = false;
    while (this.pending && (deadline === Infinity || performance.now() < deadline)) {
      const segment = this.segments[this.head];
      if (!this.dab) {
        const t = segment.next / segment.steps;
        this.dab = this.stroke.dabSteps(
          segment.x0 + (segment.x1 - segment.x0) * t,
          segment.y0 + (segment.y1 - segment.y0) * t,
          segment.brush, this.grayscale,
        );
      }
      const result = this.dab.next();
      if (result.done) {
        this.dab = undefined;
        if (++segment.next > segment.steps) this.head++;
      } else changed = result.value || changed;
    }
    if (!this.pending) {
      this.segments = [];
      this.head = 0;
    } else if (this.head > 256) {
      // A long stroke releases consumed input while retaining the active segment.
      this.segments = this.segments.slice(this.head);
      this.head = 0;
    }
    return changed;
  }
}
