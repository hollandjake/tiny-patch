export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [Key in string]: Json };
export type JsonArray = Json[];
export type Json = JsonPrimitive | JsonObject | JsonArray;

export type DeepReadonly<T> = DeepReadonlyInternal<T, never>;
type DeepReadonlyInternal<T, Seen> = T extends JsonPrimitive
    ? T
    : T extends Seen
      ? T
      : T extends object
        ? { readonly [P in keyof T]: DeepReadonlyInternal<T[P], Seen | T> }
        : T;

export type DeepMutable<T> = DeepMutableInternal<T, never>;
type DeepMutableInternal<T, Seen> = T extends JsonPrimitive
    ? T
    : T extends Seen
      ? T
      : T extends readonly (infer U)[]
        ? DeepMutableInternal<U, Seen | T>[]
        : T extends object
          ? { -readonly [P in keyof T]: DeepMutableInternal<T[P], Seen | T> }
          : T;

export type MaybeReadonly<T> = T | DeepReadonly<T>;
