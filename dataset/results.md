
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
| tiny-patch (minified) | 3756 | 41.45μs |
| tiny-patch | 6705 | 48.334μs |
| JDR | 6705 | 93.86μs |
| Fast-JSON-Patch | 6705 | 22.461μs |
| rfc6902 | 6705 | 5407.557μs |
| jiff | 10167 | 68.867μs |
| JSON8 patch | 15511 | 1.551μs |

### Stackoverflow

| ![Size of the computed patches for the dataset Stackoverflow](./graphs/Stackoverflow/size.svg) | ![Time to compute the patches for the dataset Stackoverflow](./graphs/Stackoverflow/duration.svg) |
| --- | --- |
| a) Patch size | b) Diff time |

#### Averages
| Library | Patch Size Avg (bytes) | Diff-time Avg |
| ------- | ---------------------- | ------------------ |
| tiny-patch (minified) | 2077 | 26.122μs |
| rfc6902 | 2262 | 2217.336μs |
| tiny-patch | 2297 | 33.678μs |
| JDR | 2297 | 68.601μs |
| jiff | 2349 | 48.357μs |
| JSON8 patch | 11749 | 2.845μs |
| Fast-JSON-Patch | 23622 | 21.546μs |

### Twitter

| ![Size of the computed patches for the dataset Twitter](./graphs/Twitter/size.svg) | ![Time to compute the patches for the dataset Twitter](./graphs/Twitter/duration.svg) |
| --- | --- |
| a) Patch size | b) Diff time |

#### Averages
| Library | Patch Size Avg (bytes) | Diff-time Avg |
| ------- | ---------------------- | ------------------ |
| rfc6902 | 4900 | 23741.775μs |
| tiny-patch (minified) | 17276 | 218.444μs |
| tiny-patch | 21704 | 225.545μs |
| JDR | 21704 | 674.483μs |
| Fast-JSON-Patch | 37745 | 162.847μs |
| jiff | 51080 | 385.105μs |
| JSON8 patch | 88479 | 8.166μs |

## Hardware
- Manufacturer: Apple
- Brand: M4 Pro
- Speed: 2.4GHz
