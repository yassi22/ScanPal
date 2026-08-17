declare const URLSearchParams: {
  new (
    init?:
      | string
      | Record<string, string>
      | URLSearchParams
      | Iterable<[string, string]>,
  ): URLSearchParams;
  prototype: URLSearchParams;
};

declare interface URLSearchParams {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  toString(): string;
  forEach(
    callback: (value: string, name: string, parent: URLSearchParams) => void,
  ): void;
}

declare const URL: {
  new (url: string | URL, base?: string | URL): URL;
  prototype: URL;
};

declare interface URL {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
}
