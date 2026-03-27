/**
 * ORM Pagination helper tests
 */
import { describe, it, expect } from 'bun:test';
import { PaginationHelper, CursorPaginationHelper } from '../src/orm/pagination';

describe('PaginationHelper', () => {
  describe('calculateMeta', () => {
    it('calculates totalPages correctly', () => {
      const meta = PaginationHelper.calculateMeta(100, 1, 10);
      expect(meta.totalPages).toBe(10);
    });

    it('hasNext is true when not on last page', () => {
      const meta = PaginationHelper.calculateMeta(100, 1, 10);
      expect(meta.hasNext).toBe(true);
    });

    it('hasNext is false on last page', () => {
      const meta = PaginationHelper.calculateMeta(100, 10, 10);
      expect(meta.hasNext).toBe(false);
    });

    it('hasPrev is false on first page', () => {
      const meta = PaginationHelper.calculateMeta(100, 1, 10);
      expect(meta.hasPrev).toBe(false);
    });

    it('hasPrev is true on page > 1', () => {
      const meta = PaginationHelper.calculateMeta(100, 2, 10);
      expect(meta.hasPrev).toBe(true);
    });

    it('throws when limit is 0 (prevents division by zero)', () => {
      expect(() => PaginationHelper.calculateMeta(100, 1, 0)).toThrow('Limit must be greater than 0');
    });

    it('handles total=0 gracefully', () => {
      const meta = PaginationHelper.calculateMeta(0, 1, 10);
      expect(meta.totalPages).toBe(0);
      expect(meta.hasNext).toBe(false);
    });

    it('returns correct data when total is not divisible by limit', () => {
      const meta = PaginationHelper.calculateMeta(25, 1, 10);
      expect(meta.totalPages).toBe(3);
    });
  });

  describe('validatePagination', () => {
    it('throws for page < 1', () => {
      expect(() => PaginationHelper.validatePagination(0, 10)).toThrow();
    });

    it('throws for limit < 1', () => {
      expect(() => PaginationHelper.validatePagination(1, 0)).toThrow();
    });

    it('throws for limit > 1000', () => {
      expect(() => PaginationHelper.validatePagination(1, 1001)).toThrow();
    });

    it('does not throw for valid values', () => {
      expect(() => PaginationHelper.validatePagination(1, 50)).not.toThrow();
    });
  });

  describe('calculateOffset', () => {
    it('page 1 has offset 0', () => {
      expect(PaginationHelper.calculateOffset(1, 10)).toBe(0);
    });

    it('page 2 has offset equal to limit', () => {
      expect(PaginationHelper.calculateOffset(2, 10)).toBe(10);
    });

    it('page 3 with limit 5 has offset 10', () => {
      expect(PaginationHelper.calculateOffset(3, 5)).toBe(10);
    });
  });

  describe('createPaginatedResult', () => {
    it('wraps data with correct meta', () => {
      const items = ['a', 'b', 'c'];
      const result = PaginationHelper.createPaginatedResult(items, 30, 1, 10);
      expect(result.data).toHaveLength(3);
      expect(result.total).toBe(30);
      expect(result.totalPages).toBe(3);
      expect(result.hasNext).toBe(true);
    });
  });
});

describe('CursorPaginationHelper', () => {
  it('encode → decode roundtrip', () => {
    const original = { id: '123', createdAt: '2024-01-01' };
    const cursor = CursorPaginationHelper.encodeCursor(original);
    const decoded = CursorPaginationHelper.decodeCursor(cursor);
    expect(decoded).toEqual(original);
  });

  it('throws on malformed cursor', () => {
    expect(() => CursorPaginationHelper.decodeCursor('not-base64-json!')).toThrow(
      'Invalid cursor format'
    );
  });

  it('createCursor extracts cursorField from entity', () => {
    const entity = { id: 'abc123', name: 'test' };
    const cursor = CursorPaginationHelper.createCursor(entity, 'id');
    const value = CursorPaginationHelper.extractCursorValue(cursor, 'id');
    expect(value).toBe('abc123');
  });

  it('throws when cursorField is missing from entity', () => {
    expect(() => CursorPaginationHelper.createCursor({ name: 'test' }, 'id')).toThrow(
      "Cursor field 'id' not found in entity"
    );
  });
});
