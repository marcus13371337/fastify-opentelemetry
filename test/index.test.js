const { test } = require('tap')
const { resetHistory, stub } = require('sinon')
const {
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace
} = require('@opentelemetry/api')

const {
  STUB_CONTEXT_API,
  STUB_PROPAGATION_API,
  STUB_SPAN,
  STUB_TRACER,
  STUB_TRACE_API
} = require('./fixtures/openTelemetryApi')

const openTelemetryPlugin = require('../')

async function defaultRouteHandler (request, reply) {
  return { foo: 'bar' }
}

async function setupTest (pluginOpts, routeHandler = defaultRouteHandler, hooks = {}, customize = async () => {}) {
  const fastify = require('fastify')()

  await fastify.register(openTelemetryPlugin, pluginOpts)
  fastify.get('/test', routeHandler)
  fastify.route({
    method: 'GET',
    url: '/test-with-hooks',
    handler: routeHandler,
    ...hooks
  })

  await customize(fastify)

  await fastify.ready()

  return fastify
}

const injectArgs = {
  method: 'GET',
  url: '/test',
  headers: {
    'user-agent': 'lightMyRequest',
    host: 'localhost:80'
  }
}

const injectArgsWithHooks = {
  ...injectArgs,
  url: '/test-with-hooks'
}

test('should trace a successful request', async ({ equal, same, teardown }) => {
  const fastify = await setupTest({})

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  equal(fastify.hasRequestDecorator('openTelemetry'), true, 'should decorate the request')
  equal(STUB_TRACE_API.getTracer.calledOnce, true, 'should getTracer from global provider')
  equal(STUB_TRACER.startSpan.calledOnce, true, 'should start the span')
  same(STUB_PROPAGATION_API.extract.args[0], [ROOT_CONTEXT, injectArgs.headers], 'should call propagation.extract with the req headers')

  same(STUB_SPAN.setAttributes.args[0], [{
    'req.method': injectArgs.method,
    'req.url': injectArgs.url
  }], 'should set the default request attributes')

  same(STUB_SPAN.setAttributes.args[1], [{ 'reply.statusCode': 200 }], 'should set the default reply attributes')
  same(STUB_SPAN.setStatus.args[0], [{ code: SpanStatusCode.OK }], 'should set the span status to the correct status code')
  equal(STUB_SPAN.end.calledOnce, true, 'should end the span')
})

test('should trace an unsuccessful request', async ({ equal, same, teardown }) => {
  const ERROR = Error('error')
  const routeHandler = (request, reply) => {
    reply.send(ERROR)
  }
  const fastify = await setupTest({}, routeHandler)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  equal(fastify.hasRequestDecorator('openTelemetry'), true, 'should decorate the request')
  equal(STUB_TRACE_API.getTracer.calledOnce, true, 'should getTracer from global provider')
  equal(STUB_TRACER.startSpan.calledOnce, true, 'should start the span')
  same(STUB_PROPAGATION_API.extract.args[0], [ROOT_CONTEXT, injectArgs.headers], 'should call propagation.extract with the req headers')

  same(STUB_SPAN.setAttributes.args[0], [{
    'req.method': injectArgs.method,
    'req.url': injectArgs.url
  }], 'should set the default request attributes')

  same(STUB_SPAN.setAttributes.args[1], [{
    'error.name': ERROR.name,
    'error.message': ERROR.message,
    'error.stack': ERROR.stack
  }], 'should set the default error attributes')

  same(STUB_SPAN.setAttributes.args[2], [{ 'reply.statusCode': 500 }], 'should set the default reply attributes')
  same(STUB_SPAN.setStatus.args[0], [{ code: SpanStatusCode.ERROR }], 'should set the span status to the correct status code')
  equal(STUB_SPAN.end.calledOnce, true, 'should end the span')
})

test('should trace request using provided formatSpanAttributes merged with defaults.', async ({ equal, same, teardown }) => {
  const formatSpanAttributes = {
    request (request) {
      return {
        method: request.raw.method,
        url: request.raw.url,
        userAgent: request.headers['user-agent'],
        host: request.headers.host
      }
    }
  }
  const fastify = await setupTest({ formatSpanAttributes })

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  equal(fastify.hasRequestDecorator('openTelemetry'), true, 'should decorate the request')
  equal(STUB_TRACE_API.getTracer.calledOnce, true, 'should getTracer from global provider')
  equal(STUB_TRACER.startSpan.calledOnce, true, 'should start the span')
  same(STUB_PROPAGATION_API.extract.args[0], [ROOT_CONTEXT, injectArgs.headers], 'should call propagation.extract with the req headers')

  same(STUB_SPAN.setAttributes.args[0], [{
    method: injectArgs.method,
    url: injectArgs.url,
    userAgent: injectArgs.headers['user-agent'],
    host: injectArgs.headers.host
  }], 'should set the custom request attributes')

  same(STUB_SPAN.setAttributes.args[1], [{ 'reply.statusCode': 200 }], 'should set the default reply attributes')
  same(STUB_SPAN.setStatus.args[0], [{ code: SpanStatusCode.OK }], 'should set the span status to the correct status code')
  equal(STUB_SPAN.end.calledOnce, true, 'should end the span')
})

test('should not decorate the request if exposeApi is false', async ({ equal, teardown }) => {
  const fastify = await setupTest({ exposeApi: false })

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  equal(fastify.hasRequestDecorator('openTelemetry'), false)
})

test('should be able to access context, activeSpan, extract, inject, and tracer via the request decorator', async ({ equal, teardown, same }) => {
  const replyHeaders = { foo: 'bar' }
  async function routeHandler (request, reply) {
    const {
      activeSpan,
      context,
      extract,
      inject,
      tracer
    } = request.openTelemetry()
    const newSpan = tracer.startSpan('newSpan', {}, extract(request.headers))

    activeSpan.setAttribute('foo', 'bar')
    trace.getSpan(context).setAttribute('bar', 'foo')

    inject(replyHeaders)
    reply.headers(replyHeaders)

    newSpan.end()
    return 'ok'
  }
  const fastify = await setupTest({}, routeHandler)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  const expectedContext = trace.setSpan(ROOT_CONTEXT, STUB_SPAN)

  equal(STUB_SPAN.setAttribute.calledWith('foo', 'bar'), true)
  equal(STUB_SPAN.setAttribute.calledWith('bar', 'foo'), true)
  equal(STUB_TRACER.startSpan.calledWith('newSpan'), true)
  // extract.args[0] is from the onRequest hook call.
  same(STUB_PROPAGATION_API.extract.args[1], [expectedContext, injectArgs.headers, defaultTextMapGetter])
  same(STUB_PROPAGATION_API.inject.args[0], [expectedContext, replyHeaders, defaultTextMapSetter])
})

test('should wrap all routes when wrapRoutes is true', async ({ equal, same, teardown }) => {
  const dummyContext = trace.setSpan(ROOT_CONTEXT, STUB_SPAN)

  const fastify = require('fastify')()

  await fastify.register(openTelemetryPlugin, { wrapRoutes: true })

  async function testHandlerOne (request, reply) {
    request.openTelemetry()
    reply.headers({ one: 'ok' })
    return { body: 'one' }
  }

  async function testHandlerTwo (request, reply) {
    request.openTelemetry()
    reply.headers({ two: 'ok' })
    return { body: 'two' }
  }

  fastify.get('/testOne', testHandlerOne)
  fastify.get('/testTwo', testHandlerTwo)

  fastify.ready()

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  const resOne = await fastify.inject({ ...injectArgs, url: '/testOne' })
  const resTwo = await fastify.inject({ ...injectArgs, url: '/testTwo' })

  equal(resOne.statusCode, 200)
  equal(resOne.headers.one, 'ok')
  equal(resOne.json().body, 'one')
  equal(resTwo.statusCode, 200)
  equal(resTwo.headers.two, 'ok')
  equal(resTwo.json().body, 'two')
  same(STUB_CONTEXT_API.with.args[0][0], dummyContext)
  same(STUB_CONTEXT_API.with.args[1][0], dummyContext)
})

test('should only wrap routes provided in wrapRoutes array', async ({ same, equal, teardown }) => {
  const dummyContext = trace.setSpan(ROOT_CONTEXT, STUB_SPAN)

  const fastify = require('fastify')()

  await fastify.register(openTelemetryPlugin, { wrapRoutes: ['/testTwo'] })

  const testHandlerOne = async () => 'one'
  const testHandlerTwo = async () => 'two'

  fastify.get('/testOne', testHandlerOne)
  fastify.get('/testTwo', testHandlerTwo)

  fastify.ready()

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject({ ...injectArgs, url: '/testOne' })
  await fastify.inject({ ...injectArgs, url: '/testTwo' })

  equal(STUB_CONTEXT_API.with.calledOnce, true)
  same(STUB_CONTEXT_API.with.args[0][0], dummyContext)
  same(await STUB_CONTEXT_API.with.args[0][1](), await testHandlerTwo())
})

test('should ignore routes found in ignoreRoutes array', async ({ equal, same, teardown }) => {
  const ERROR = Error('error')

  const results = {}
  async function routeHandler (request, reply) {
    const {
      context,
      activeSpan
    } = request.openTelemetry()
    results.context = context
    results.activeSpan = activeSpan
    // Return error to cover onError hook as well as onRequest, and onReply.
    return ERROR
  }
  const fastify = await setupTest({ wrapRoutes: true, ignoreRoutes: ['/test'] }, routeHandler)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  same(results.context, ROOT_CONTEXT)
  equal(results.activeSpan, undefined)
  equal(STUB_TRACER.startSpan.args.length, 0)
  equal(STUB_PROPAGATION_API.extract.args.length, 0)
  equal(STUB_SPAN.setAttributes.args.length, 0)
  equal(STUB_SPAN.setStatus.args.length, 0)
  equal(STUB_SPAN.end.args.length, 0)
  equal(STUB_CONTEXT_API.with.args.length, 0)
})

test('should ignore routes for which the ignoreRoutes function returns true', async ({ equal, same, teardown }) => {
  const ERROR = Error('error')

  const results = {}
  async function routeHandler (request, reply) {
    const {
      context,
      activeSpan
    } = request.openTelemetry()
    results.context = context
    results.activeSpan = activeSpan
    // Return error to cover onError hook as well as onRequest, and onReply.
    return ERROR
  }

  const ignoreRoutes = (path, method) => path === '/test' && method === 'GET'

  const fastify = await setupTest({ wrapRoutes: true, ignoreRoutes }, routeHandler)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  same(results.context, ROOT_CONTEXT)
  equal(results.activeSpan, undefined)
  equal(STUB_TRACER.startSpan.args.length, 0)
  equal(STUB_PROPAGATION_API.extract.args.length, 0)
  equal(STUB_SPAN.setAttributes.args.length, 0)
  equal(STUB_SPAN.setStatus.args.length, 0)
  equal(STUB_SPAN.end.args.length, 0)
  equal(STUB_CONTEXT_API.with.args.length, 0)
})

test('should break if fastify instance is not provided', async ({ rejects }) => {
  rejects(openTelemetryPlugin)
})

test('should not extract context headers, if an active context exists locally.', async ({ equal, same, teardown }) => {
  const fastify = await setupTest({})

  const activeContext = stub(context, 'active').returns({ getValue: () => STUB_SPAN, setValue: () => null })

  teardown(() => {
    activeContext.restore()
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)

  same(STUB_PROPAGATION_API.extract.args.length, 0, 'should not call propagation.extract')

  // Run the usual assertions, just to make sure that every thing else goes as expected...
  equal(fastify.hasRequestDecorator('openTelemetry'), true, 'should decorate the request')
  equal(STUB_TRACE_API.getTracer.calledOnce, true, 'should getTracer from global provider')
  equal(STUB_TRACER.startSpan.calledOnce, true, 'should start the span')

  same(STUB_SPAN.setAttributes.args[0], [{
    'req.method': injectArgs.method,
    'req.url': injectArgs.url
  }], 'should set the default request attributes')

  same(STUB_SPAN.setAttributes.args[1], [{ 'reply.statusCode': 200 }], 'should set the default reply attributes')
  same(STUB_SPAN.setStatus.args[0], [{ code: SpanStatusCode.OK }], 'should set the span status to the correct status code')
  equal(STUB_SPAN.end.calledOnce, true, 'should end the span')
})

test('should preserve this binding in handler using wrapRoutes', async ({ equal, teardown }) => {
  let actual
  async function handleRequest (request, reply) {
    if (!this) {
      throw new Error('this is undefined')
    }
    actual = this
    return {}
  }

  const fastify = await setupTest({
    wrapRoutes: true
  }, handleRequest)

  const reply = await fastify.inject(injectArgs)
  equal(reply.statusCode, 200)
  equal(fastify, actual)

  teardown(() => {
    resetHistory()
    fastify.close()
  })
})

test('should use router path in span name', async ({ same, teardown }) => {
  const fastify = await setupTest({})

  const activeContext = stub(context, 'active').returns({
    getValue: () => STUB_SPAN,
    setValue: () => null
  })

  teardown(() => {
    activeContext.restore()
    resetHistory()
    fastify.close()
  })

  await fastify.inject(injectArgs)
  await fastify.inject({ ...injectArgs, url: '/invalid' })

  same(
    STUB_TRACER.startSpan.args[0][0],
    'GET /test',
    'should contain router path'
  )
  same(
    STUB_TRACER.startSpan.args[1][0],
    'GET',
    'should not contain router path when no matching routes found'
  )
})

test('should wrap all hooks associated with a route', async ({ equal, same, teardown }) => {
  const dummyContext = trace.setSpan(ROOT_CONTEXT, STUB_SPAN)

  const results = {}

  const createHookHandler = (name) => {
    return async function hookHandler (request, reply) {
      const {
        context,
        activeSpan
      } = request.openTelemetry()

      results[name] = {
        context,
        activeSpan
      }
    }
  }

  const hooks = {
    onRequest: createHookHandler('onRequest'),
    preParsing: createHookHandler('preParsing'),
    preValidation: createHookHandler('preValidation'),
    preHandler: createHookHandler('preHandler'),
    preSerialization: createHookHandler('preSerialization'),
    onSend: createHookHandler('onSend'),
    onResponse: createHookHandler('onResponse')
  }

  const fastify = await setupTest({ wrapRoutes: true }, defaultRouteHandler, hooks)

  await fastify.inject(injectArgsWithHooks)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  same(results.onRequest.context, dummyContext)
  equal(results.onRequest.activeSpan, STUB_SPAN)

  same(results.preParsing.context, dummyContext)
  equal(results.preParsing.activeSpan, STUB_SPAN)

  same(results.preValidation.context, dummyContext)
  equal(results.preValidation.activeSpan, STUB_SPAN)

  same(results.preHandler.context, dummyContext)
  equal(results.preHandler.activeSpan, STUB_SPAN)

  same(results.preSerialization.context, dummyContext)
  equal(results.preSerialization.activeSpan, STUB_SPAN)

  same(results.onSend.context, dummyContext)
  equal(results.onSend.activeSpan, STUB_SPAN)

  same(results.onResponse.context, dummyContext)
  equal(results.onResponse.activeSpan, STUB_SPAN)
})

test('should wrap all hooks associated with a route if arrays', async ({ equal, same, teardown }) => {
  const dummyContext = trace.setSpan(ROOT_CONTEXT, STUB_SPAN)

  const results = {}

  const createHookHandler = (name) => {
    return async function hookHandler (request, reply) {
      const {
        context,
        activeSpan
      } = request.openTelemetry()

      results[name] = {
        context,
        activeSpan
      }
    }
  }

  const hooks = {
    onRequest: [createHookHandler('onRequest'), createHookHandler('onRequest2')],
    preValidation: [createHookHandler('preValidation'), createHookHandler('preValidation2')],
    onResponse: [createHookHandler('onResponse'), createHookHandler('onResponse2')],
    onSend: [createHookHandler('onSend'), createHookHandler('onSend2')]
  }

  const fastify = await setupTest({ wrapRoutes: true }, defaultRouteHandler, hooks)

  await fastify.inject(injectArgsWithHooks)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  same(results.onRequest.context, dummyContext)
  equal(results.onRequest.activeSpan, STUB_SPAN)
  same(results.onRequest2.context, dummyContext)
  equal(results.onRequest2.activeSpan, STUB_SPAN)

  same(results.preValidation.context, dummyContext)
  equal(results.preValidation.activeSpan, STUB_SPAN)
  same(results.preValidation2.context, dummyContext)
  equal(results.preValidation2.activeSpan, STUB_SPAN)

  same(results.onResponse.context, dummyContext)
  equal(results.onResponse.activeSpan, STUB_SPAN)
  same(results.onResponse2.context, dummyContext)
  equal(results.onResponse2.activeSpan, STUB_SPAN)

  same(results.onSend.context, dummyContext)
  equal(results.onSend.activeSpan, STUB_SPAN)
  same(results.onSend2.context, dummyContext)
  equal(results.onSend2.activeSpan, STUB_SPAN)
})

test('adds context to hooks added outside of the route options', async ({ equal, same, teardown }) => {
  const dummyContext = trace.setSpan(ROOT_CONTEXT, STUB_SPAN)

  const results = {}

  const createHookHandler = (name) => {
    return async function hookHandler (request, reply) {
      const {
        context,
        activeSpan
      } = request.openTelemetry()

      results[name] = {
        context,
        activeSpan
      }
    }
  }

  const hooks = {
    onRequest: createHookHandler('onRequest'),
    preParsing: createHookHandler('preParsing'),
    preValidation: createHookHandler('preValidation'),
    preHandler: createHookHandler('preHandler'),
    preSerialization: createHookHandler('preSerialization'),
    onSend: createHookHandler('onSend'),
    onResponse: createHookHandler('onResponse')
  }

  const fastify = await setupTest({ wrapRoutes: true }, defaultRouteHandler, {}, (fastify) => {
    fastify.addHook('onRequest', hooks.onRequest)
    fastify.addHook('preParsing', hooks.preParsing)
    fastify.addHook('preValidation', hooks.preValidation)
    fastify.addHook('preHandler', hooks.preHandler)
    fastify.addHook('preSerialization', hooks.preSerialization)
    fastify.addHook('onSend', hooks.onSend)
    fastify.addHook('onResponse', hooks.onResponse)
  })

  await fastify.inject(injectArgs)

  teardown(() => {
    resetHistory()
    fastify.close()
  })

  same(results.onRequest.context, dummyContext)
  equal(results.onRequest.activeSpan, STUB_SPAN)

  same(results.preParsing.context, dummyContext)
  equal(results.preParsing.activeSpan, STUB_SPAN)

  same(results.preValidation.context, dummyContext)
  equal(results.preValidation.activeSpan, STUB_SPAN)

  same(results.preHandler.context, dummyContext)
  equal(results.preHandler.activeSpan, STUB_SPAN)

  same(results.preSerialization.context, dummyContext)
  equal(results.preSerialization.activeSpan, STUB_SPAN)

  same(results.onSend.context, dummyContext)
  equal(results.onSend.activeSpan, STUB_SPAN)

  same(results.onResponse.context, dummyContext)
  equal(results.onResponse.activeSpan, STUB_SPAN)
})
