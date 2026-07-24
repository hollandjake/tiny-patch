export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [Key in string]: Json };
export type JsonArray = Json[];
export type Json = JsonPrimitive | JsonObject | JsonArray;
