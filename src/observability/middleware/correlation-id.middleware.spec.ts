import { Request, Response } from 'express';
import { CorrelationIdMiddleware, CORRELATION_ID_HEADER } from './correlation-id.middleware';

interface MockReq {
  headers: Record<string, string>;
}
interface MockRes {
  setHeader: jest.Mock;
}
function makeReq(headers: Record<string, string> = {}): MockReq {
  return { headers: { ...headers } };
}
function makeRes(): MockRes {
  return { setHeader: jest.fn() };
}
function asReq(r: MockReq): Request {
  return r as unknown as Request;
}
function asRes(r: MockRes): Response {
  return r as unknown as Response;
}
const next = jest.fn();

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
    next.mockClear();
  });

  it('calls next()', () => {
    middleware.use(asReq(makeReq()), asRes(makeRes()), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses the existing correlation id when present', () => {
    const req = makeReq({ [CORRELATION_ID_HEADER]: 'existing-id' });
    const res = makeRes();
    middleware.use(asReq(req), asRes(res), next);
    expect(req.headers[CORRELATION_ID_HEADER]).toBe('existing-id');
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'existing-id');
  });

  it('generates a UUID when no correlation id is present', () => {
    const req = makeReq();
    const res = makeRes();
    middleware.use(asReq(req), asRes(res), next);
    const id = req.headers[CORRELATION_ID_HEADER] as string;
    expect(typeof id).toBe('string');
    // UUID format: 8-4-4-4-12
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('echoes the generated id to the response header', () => {
    const req = makeReq();
    const res = makeRes();
    middleware.use(asReq(req), asRes(res), next);
    const id = req.headers[CORRELATION_ID_HEADER];
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, id);
  });

  it('generates different ids for different requests', () => {
    const req1 = makeReq();
    const req2 = makeReq();
    middleware.use(asReq(req1), asRes(makeRes()), next);
    middleware.use(asReq(req2), asRes(makeRes()), next);
    expect(req1.headers[CORRELATION_ID_HEADER]).not.toBe(req2.headers[CORRELATION_ID_HEADER]);
  });

  it('normalises the request header so it is always present after middleware', () => {
    const req = makeReq(); // no correlation id
    middleware.use(asReq(req), asRes(makeRes()), next);
    expect(req.headers[CORRELATION_ID_HEADER]).toBeDefined();
  });
});
