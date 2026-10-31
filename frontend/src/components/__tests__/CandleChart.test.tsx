import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CandleChart } from "../CandleChart";
import type { Candle } from "../../types.pages";

/**
 * Pan, zoom and reset. jsdom has no layout, so the svg is given a 1000px width:
 * the candle area is then 936px (the chart reserves 64 of 1000 for the price
 * axis), i.e. 9.36px per candle while 100 are in view.
 */

/**
 * jsdom has no PointerEvent, so Testing Library's `fireEvent.pointerMove` would
 * drop `clientX`. A MouseEvent carrying a pointer event's name reaches React's
 * pointer handlers with the coordinate intact.
 */
const pointer = (el: Element, type: string, clientX: number) =>
  fireEvent(el, new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));

const series = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `D${String(i).padStart(3, "0")}`,
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 105 + i,
    volume: 1000 + i,
  }));

function draw(n: number, initialCount?: number) {
  const candles = series(n);
  const utils = render(<CandleChart candles={candles} initialCount={initialCount} />);
  const svg = screen.getByRole("img");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 1000, bottom: 400, width: 1000, height: 400, x: 0, y: 0, toJSON: () => ({}),
  });
  const first = () => svg.querySelector('text[x="2"]')?.textContent;
  const last = () => svg.querySelector('text[text-anchor="end"]')?.textContent;
  const count = () => Number(/(\d+) sessions/.exec(svg.getAttribute("aria-label") ?? "")?.[1]);
  return { candles, svg, first, last, count, ...utils };
}

describe("CandleChart view", () => {
  it("opens on the newest initialCount candles", () => {
    const { count, first, last } = draw(300, 100);
    expect(count()).toBe(100);
    expect(first()).toBe("D200");
    expect(last()).toBe("D299");
  });

  it("shows the whole series when no initialCount is given", () => {
    const { count, first } = draw(40);
    expect(count()).toBe(40);
    expect(first()).toBe("D000");
  });

  it("does not open on more candles than exist", () => {
    expect(draw(30, 100).count()).toBe(30);
  });
});

describe("CandleChart pan", () => {
  it("drags back through history", () => {
    const { svg, first, last, count } = draw(300, 100);

    pointer(svg, "pointerdown", 500);
    pointer(svg, "pointermove", 593.6); // 10 candles right
    pointer(svg, "pointerup", 0);

    expect(count()).toBe(100);
    expect(last()).toBe("D289");
    expect(first()).toBe("D190");
  });

  it("drags forward again, but never past the newest candle", () => {
    const { svg, last } = draw(300, 100);

    pointer(svg, "pointerdown", 500);
    pointer(svg, "pointermove", 593.6);
    pointer(svg, "pointermove", 0); // far left of the start
    expect(last()).toBe("D299");
  });

  it("stops at the oldest candle", () => {
    const { svg, first } = draw(300, 100);

    pointer(svg, "pointerdown", 0);
    pointer(svg, "pointermove", 100_000);

    expect(first()).toBe("D000");
  });

  it("does nothing on a plain move without a press", () => {
    const { svg, last } = draw(300, 100);
    pointer(svg, "pointermove", 400);
    expect(last()).toBe("D299");
  });

  it("stops following the pointer once released", () => {
    const { svg, last } = draw(300, 100);
    pointer(svg, "pointerdown", 500);
    pointer(svg, "pointerup", 0);
    pointer(svg, "pointermove", 900);
    expect(last()).toBe("D299");
  });
});

describe("CandleChart zoom", () => {
  it("zooms in on scroll up, keeping the newest candle when the cursor is at the right edge", () => {
    const { svg, count, last } = draw(300, 100);
    fireEvent.wheel(svg, { deltaY: -100, clientX: 936 });
    expect(count()).toBe(85);
    expect(last()).toBe("D299");
  });

  it("zooms out on scroll down", () => {
    const { svg, count } = draw(300, 100);
    fireEvent.wheel(svg, { deltaY: 100, clientX: 936 });
    expect(count()).toBe(118);
  });

  it("keeps the candle under the cursor in place", () => {
    const { svg, first, last } = draw(300, 100);
    // Cursor at the left edge: the oldest visible candle stays put.
    fireEvent.wheel(svg, { deltaY: -100, clientX: 0 });
    expect(first()).toBe("D200");
    expect(last()).toBe("D284");
  });

  it("will not zoom in past 10 candles", () => {
    const { svg, count } = draw(300, 100);
    for (let i = 0; i < 40; i++) fireEvent.wheel(svg, { deltaY: -100, clientX: 936 });
    expect(count()).toBe(10);
  });

  it("will not zoom out past the whole series", () => {
    const { svg, count } = draw(300, 100);
    for (let i = 0; i < 40; i++) fireEvent.wheel(svg, { deltaY: 100, clientX: 936 });
    expect(count()).toBe(300);
  });

  it("stops the page scrolling underneath", () => {
    const { svg } = draw(300, 100);
    const wheel = new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true });
    act(() => {
      svg.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("refits the price scale to what is in view", () => {
    const { svg } = draw(300, 100);
    const top = () => Number(svg.querySelectorAll("text.chart-axis-label")[4]?.textContent);
    const before = top();
    for (let i = 0; i < 40; i++) fireEvent.wheel(svg, { deltaY: -100, clientX: 936 });
    // Ten newest candles span a narrower price range than a hundred did.
    expect(top()).toBeLessThan(before + 1);
    expect(top()).toBeGreaterThan(0);
  });
});

describe("CandleChart reset", () => {
  it("returns to the opening view on double click", () => {
    const { svg, count, last } = draw(300, 100);
    fireEvent.wheel(svg, { deltaY: -100, clientX: 936 });
    pointer(svg, "pointerdown", 500);
    pointer(svg, "pointermove", 600);
    pointer(svg, "pointerup", 0);
    expect(last()).not.toBe("D299");

    fireEvent.doubleClick(svg);

    expect(count()).toBe(100);
    expect(last()).toBe("D299");
  });

  it("starts over when the series changes", () => {
    const { svg, rerender, last } = draw(300, 100);
    pointer(svg, "pointerdown", 500);
    pointer(svg, "pointermove", 700);
    pointer(svg, "pointerup", 0);
    expect(last()).not.toBe("D299");

    rerender(<CandleChart candles={series(300)} initialCount={100} />);

    expect(last()).toBe("D299");
  });
});

describe("CandleChart small series", () => {
  it("shows the empty state for no candles", () => {
    render(<CandleChart candles={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("No price history");
  });

  it("copes with fewer candles than the zoom floor", () => {
    const { svg, count } = draw(5);
    fireEvent.wheel(svg, { deltaY: -100, clientX: 936 });
    pointer(svg, "pointerdown", 500);
    pointer(svg, "pointermove", 900);
    expect(count()).toBe(5);
  });
});
