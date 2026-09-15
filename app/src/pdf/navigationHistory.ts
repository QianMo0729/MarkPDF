/** A PDF position, independent of the application's route/browser history. */
export interface PdfPosition {
  page: number;
  left: number;
  top: number;
  scaleValue: string;
  rotation: number;
  viewMode: "single" | "continuous";
}

const samePosition = (a: PdfPosition, b: PdfPosition) =>
  a.page === b.page && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 &&
  a.scaleValue === b.scaleValue && a.rotation === b.rotation && a.viewMode === b.viewMode;

/** Only explicit jumps add entries; ordinary reading/scrolling does not. */
export class PdfNavigationHistory {
  private previous: PdfPosition[] = [];
  private next: PdfPosition[] = [];

  get canGoBack() { return this.previous.length > 0; }
  get canGoForward() { return this.next.length > 0; }

  clear() {
    this.previous = [];
    this.next = [];
  }

  remember(position: PdfPosition) {
    const last = this.previous[this.previous.length - 1];
    if (!last || !samePosition(last, position)) this.previous.push(position);
    // Keep memory bounded, including while a document is open for a whole lecture.
    if (this.previous.length > 100) this.previous.shift();
    this.next = [];
  }

  back(current: PdfPosition): PdfPosition | undefined {
    return this.move(this.previous, this.next, current);
  }

  forward(current: PdfPosition): PdfPosition | undefined {
    return this.move(this.next, this.previous, current);
  }

  private move(from: PdfPosition[], to: PdfPosition[], current: PdfPosition) {
    let target: PdfPosition | undefined;
    // A repeated link or a match already in view must not trap Back on a no-op.
    while ((target = from.pop())) {
      if (!samePosition(target, current)) {
        to.push(current);
        return target;
      }
    }
    return undefined;
  }
}
