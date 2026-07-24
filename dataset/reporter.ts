import * as path from "node:path";
import { Chart, Legend, LinearScale, LineElement, PointElement, ScatterController, Title, Tooltip } from "chart.js";
import { Canvas } from "skia-canvas";
import si from "systeminformation";
import { run, SOURCES } from "./runner";

Chart.register(ScatterController, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const docFile = Bun.file(path.join(__dirname, `results.md`));
await docFile.write("");
const docWriter = docFile.writer();
docWriter.write(`
# Results

This document outlines the performance of the different available algorithms against the
[JSON diff dataset](https://github.com/caohanyang/json_diff_rfc6902/tree/master/dataset)

## Results

Documented below is the performance of the different available algorithms against each dataset

`);

for (const source of SOURCES) {
    const result = await run(source);
    const resNoRFC6902 = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "rfc6902"));
    const byteLengthChart = await generateChart(
        `Size of the computed patches for the dataset ${source}`,
        "Patch size(byte)",
        "byteLength",
        resNoRFC6902 as never,
    );
    const diffTimeChart = await generateChart(
        `Time to compute the patches for the dataset ${source}`,
        "Diff time(ms)",
        "duration",
        Object.fromEntries(
            Object.entries(resNoRFC6902).map(([k, v]) => [
                k,
                v.map((v) => ({ byteLength: v.byteLength, duration: v.duration / 1_000_000 })),
            ]),
        ) as never,
    );
    docWriter.write(`
### ${source}

| ![Size of the computed patches for the dataset ${source}](${byteLengthChart}) | ![Time to compute the patches for the dataset ${source}](${diffTimeChart}) |
| --- | --- |
| a) Patch size | b) Diff time |

#### Averages
| Library | Patch Size Avg (bytes) | Diff-time Avg |
| ------- | ---------------------- | ------------------ |
${Object.entries(result)
    .map(
        ([k, res]) =>
            [
                k,
                {
                    byteLength: res.reduce((sum, r) => sum + r.byteLength, 0) / res.length,
                    duration: res.reduce((sum, r) => sum + r.duration, 0) / res.length,
                } as const,
            ] as const,
    )
    .sort((a, b) => a[1].byteLength - b[1].byteLength)
    .map(([algorithm, { byteLength, duration }]) => {
        return `| ${algorithm} | ${Math.floor(byteLength)} | ${formatDurationString(duration)} |`;
    })
    .join("\n")}
`);
}

const cpuStats = await si.cpu();

await docWriter.write(
    `
## Hardware
- Manufacturer: ${cpuStats.manufacturer}
- Brand: ${cpuStats.brand}
- Speed: ${cpuStats.speed}GHz
`,
);

await docWriter.end();

type ResType = Awaited<ReturnType<typeof run>>;

async function generateChart(title: string, unit: string, key: keyof ResType[keyof ResType][number], results: ResType) {
    const KEYS = Object.keys(results);

    const canvas = new Canvas(100 * KEYS.length, 400);
    const chart = new Chart(canvas, {
        type: "scatter",
        plugins: [
            {
                id: "panelBackground",
                beforeDraw(chart: Chart) {
                    const { ctx, chartArea, width, height } = chart;
                    ctx.save();
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, width, height);
                    if (chartArea) {
                        ctx.fillStyle = "#ebebeb";
                        ctx.fillRect(
                            chartArea.left,
                            chartArea.top,
                            chartArea.right - chartArea.left,
                            chartArea.bottom - chartArea.top,
                        );
                    }
                    ctx.restore();
                },
            },
        ],
        data: {
            datasets: [
                {
                    label: "Data",
                    data: Object.values(results).flatMap((res, i) => {
                        return res.map((r, j) => ({
                            x: i + 0.3 + (j / res.length) * 0.4,
                            y: r[key],
                        }));
                    }),
                    pointRadius: 2,
                    pointBackgroundColor: "#000",
                    pointBorderColor: "#000",
                    order: 2,
                    normalized: true,
                },
                {
                    label: "Mean",
                    data: Object.values(results).map((res, i) => {
                        const mean = res.reduce((sum, r) => sum + r[key], 0) / res.length;
                        return {
                            x: i + 0.5,
                            y: mean,
                        };
                    }),
                    pointStyle: "rectRot",
                    pointRadius: 6,
                    backgroundColor: "#e41a1c",
                    borderColor: "#e41a1c",
                    order: 1,
                    normalized: true,
                },
            ],
        },
        options: {
            responsive: false,
            plugins: {
                title: {
                    display: true,
                    text: title,
                    color: "#000",
                    font: { weight: "normal" },
                },
                // Single series - the title already names it, so no legend box is needed.
                legend: { display: false },
            },
            scales: {
                x: {
                    min: 0,
                    max: KEYS.length,
                    afterBuildTicks: (axis) => {
                        axis.ticks = KEYS.map((_, i) => ({ value: i + 0.5 }));
                    },
                    ticks: {
                        color: "#000",
                        callback: (value) => KEYS[Math.floor(Number(value))] ?? "",
                        minRotation: 0,
                        maxRotation: 0,
                        align: "center",
                        crossAlign: "center",
                        autoSkip: false,
                    },
                    grid: { color: "#ffffff" },
                    border: { display: false },
                    title: { display: false },
                },
                y: {
                    ticks: {
                        color: "#000",
                    },
                    grid: { color: "#ffffff" },
                    border: { display: false },
                    title: { display: true, text: unit, color: "#000" },
                },
            },
        },
    });

    try {
        return await canvas.toURL("jpg");
    } finally {
        chart.destroy();
    }
}

export function formatDurationString(durationNs: number) {
    const value = Math.floor(durationNs) / 1_000;
    return `${value}μs`;
}
