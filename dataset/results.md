
# Results

This document outlines the performance of the different available algorithms against the
[JSON diff dataset](https://github.com/caohanyang/json_diff_rfc6902/tree/master/dataset)

## Results

Documented below is the performance of the different available algorithms against each dataset


### Xignite

| ![Size of the computed patches for the dataset Xignite](./graphs/Xignite/size.svg) | ![Time to compute the patches for the dataset Xignite](./graphs/Xignite/duration.svg) |
| --- | --- |
| a) Patch size | b) Diff time |

#### Averages
| Library | Patch Size Avg (bytes) | Diff-time Avg |
| ------- | ---------------------- | ------------------ |
| tiny-patch (minified) | 3756 | 43.499μs |
| tiny-patch | 6705 | 52.343μs |
| JDR | 6705 | 93.755μs |
| Fast-JSON-Patch | 6705 | 21.996μs |
| rfc6902 | 6705 | 5358.589μs |
| jiff | 10167 | 68.238μs |
| JSON8 patch | 15511 | 1.674μs |

### Stackoverflow

| ![Size of the computed patches for the dataset Stackoverflow](./graphs/Stackoverflow/size.svg) | ![Time to compute the patches for the dataset Stackoverflow](./graphs/Stackoverflow/duration.svg) |
| --- | --- |
| a) Patch size | b) Diff time |

#### Averages
| Library | Patch Size Avg (bytes) | Diff-time Avg |
| ------- | ---------------------- | ------------------ |
| tiny-patch (minified) | 2077 | 25.916μs |
| rfc6902 | 2262 | 2138.689μs |
| tiny-patch | 2297 | 33.61μs |
| JDR | 2297 | 69.015μs |
| jiff | 2349 | 47.853μs |
| JSON8 patch | 11749 | 2.704μs |
| Fast-JSON-Patch | 23622 | 20.563μs |

### Twitter

| ![Size of the computed patches for the dataset Twitter](./graphs/Twitter/size.svg) | ![Time to compute the patches for the dataset Twitter](./graphs/Twitter/duration.svg) |
| --- | --- |
| a) Patch size | b) Diff time |

#### Averages
| Library | Patch Size Avg (bytes) | Diff-time Avg |
| ------- | ---------------------- | ------------------ |
| rfc6902 | 4900 | 23193.535μs |
| tiny-patch (minified) | 17276 | 222.88μs |
| tiny-patch | 21704 | 234.404μs |
| JDR | 21704 | 652.952μs |
| Fast-JSON-Patch | 37745 | 160.153μs |
| jiff | 51080 | 372.171μs |
| JSON8 patch | 88479 | 8.432μs |

## Hardware
- Manufacturer: Apple
- Brand: M4 Pro
- Speed: 2.4GHz
