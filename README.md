[![npm package](https://img.shields.io/npm/v/tiny-patch.svg)](https://www.npmjs.com/package/tiny-patch)
[![documentation](https://img.shields.io/badge/documentation-yes-brightgreen.svg) ](https://github.com/hollandjake/tiny-patch/blob/main/README.md)
[![licence](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/hollandjake/tiny-patch/blob/main/LICENSE)

# Tiny-Patch

> Implementation of JSONPatch (RFC6902) with diff and patch support, 
> optimized for performance in a JS environment,
> with support for a minified output to reduce bandwidth
> Also offers "diff" functionality to creating patches without `Object.observe`

## Installation

```sh
npm install tiny-patch
```

### Import into your script

```ts
const { diff, apply } = require('tiny-patch');
```

or

```ts
import { diff, apply } from 'tiny-patch';
```

or in browser (with UMD)

```html

<script src="https://unpkg.com/tiny-patch"></script>

<script>
    const {diff, apply} = tinypatch;
</script>
```

## Usage

### Calculate diff between two objects

```ts
diff({ first: 'Jake' }, { first: 'Jake', last: 'Holland' });
// [{op: 'add', path: '/last', value: 'Holland'}]
```

### Apply a patch

```ts
const obj = { first: 'Jake' };
const patch = [{op: 'add', path: '/last', value: 'Holland'}];
apply(obj, patch);
// { first: 'Jake', last: 'Holland' }
```

## Performance

Want to know how this library performs compared to others?

| ![Size of the computed patches for the dataset Xignite](./dataset/graphs/Xignite/size.svg) | ![Time to compute the patches for the dataset Xignite](./dataset/graphs/Xignite/duration.svg) |
|--------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| a) Patch size                                                                              | b) Diff time                                                                                  |

Full details can be found in this [report](./dataset/results.md)

## API

### `diff(input: Json | undefined, output: Json | undefined, opts?: DiffOptions): Patch`

<details>
<summary>Optional <code>DiffOptions</code> argument</summary>

#### `opts.hash(val: Json): number`

Optional user defined hash function, allowing you to provide a tracking identifier for an element in an array.
By default, this is a deep hash on the value to deduplicate collisions, 
however if you wanted to track elements using something like an `id` field,
then even if there were changes on that element it will still be tracked as a move operation (and then an edit).

#### `opts.transform = 'maximize'`

Configure whether to transform the output patch into `minify`, `maximize`, by default it will return a maximized patch,
but for a further byte reduction you can minify it.

</details>

Returns a list of operations (a JSON Patch) comprised of the operations to transform `oldJson` into `newJson`.

For array transformations we attempt to reduce the size of operations by running the JDR algorithm to determine `move` and `copy` operations which could occur (rather than full replacements). This enables full operation support for arrays.

### `apply(target: Json | undefined, patch: Patch, opts?: ApplyOpts): any`

<details>
<summary>Optional <code>ApplyOpts</code> argument</summary>

#### `opts.preserveKeyOrder = false`

When a "move" op renames a key within the same parent object, preserve the key's original
position instead of moving it to the end (the standard remove+add behavior). Disabled by
default since it costs an extra rebuild of the parent object.

</details>

Takes a given patch and applies the operations to a deep copy of the target,
it returns the final modified outcome of all the patches.

A value of `undefined` is a special root case in which a delete operation has taken place on the root.

If any of the operations fail, an error is thrown with details as to what happened.

## Homepage

You can find more about this on [GitHub](https://github.com/hollandjake/tiny-patch).

## Contributing

Contributions, issues and feature requests are welcome!

Feel free to check [issues page](https://github.com/hollandjake/tiny-patch/issues).

## Credits

Thanks to [rfc6902](https://github.com/chbrown/rfc6902) and [json-diff-rfc6902](https://github.com/caohanyang/json_diff_rfc6902) for the inspiration

## Authors

- **[Jake Holland](https://github.com/hollandjake)**

See also the list of [contributors](https://github.com/hollandjake/tiny-patch/contributors) who participated in this
project.

## License

This project is [MIT](https://github.com/hollandjake/tiny-patch/blob/main/LICENSE) licensed.
