// Load configured OpenTelemetry SDK first.
require('./opentelemetry')

const fastify = require('fastify')()
const fetch = require('node-fetch')
const fastifyOpentelemetry = require('..')

const boredApi = 'http://www.boredapi.com'

const start = async () => {
  await fastify.register(fastifyOpentelemetry, { wrapRoutes: true })

  fastify.get('/', async function routeHandler (request, reply) {
    const {
      tracer
    } = request.openTelemetry()
    let childSpan
    try {
      // @opentelemetry/instrumentation-http will automatically trace incoming and out going http/https requests.
      const activityRes = await fetch(`${boredApi}/api/activity`)
      // Spans started in a wrapped route will automatically be children of the activeSpan.
      childSpan = tracer.startSpan('preparing content')
      const { activity } = await activityRes.json()
      reply.type('text/html')
      return `<h1>Bored?</h1><h3>Have you tried to ${activity.toLowerCase()}</h3>`
    } catch (error) {
      // fastify-opentelemetry automatically adds error data to the parent spans attributes.
      return error
    } finally {
      // Always be sure to end child spans.
      if (childSpan) childSpan.end()
    }
  })

  fastify.route({
    url: '/with-hooks',
    method: 'GET',
    handler: async function routeHandler (request, reply) {
      return 'Hello World With hooks!'
    },
    preValidation: function preValidation (request, reply, done) {
      const { activeSpan } = request.openTelemetry()

      activeSpan.addEvent('preValidation')

      done()
    }
  })

  fastify.get('/:type', async function routeHandler (request, reply) {
    const { tracer } = request.openTelemetry()
    let childSpan
    try {
      // @opentelemetry/instrumentation-http will automatically trace incoming and out going http/https requests.
      const activityRes = await fetch(
        `${boredApi}/api/activity?type=${request.params.type}`
      )
      // Spans started in a wrapped route will automatically be children of the activeSpan.
      childSpan = tracer.startSpan(`preparing content of ${request.params.type}`)
      const { activity, error } = await activityRes.json()

      if (error) {
        throw error
      }

      reply.type('text/html')
      return `<h1>Bored?</h1><h3>Have you tried to ${activity.toLowerCase()}</h3>`
    } catch (error) {
      // fastify-opentelemetry automatically adds error data to the parent spans attributes.
      return error
    } finally {
      // Always be sure to end child spans.
      if (childSpan) childSpan.end()
    }
  })

  const port = process.env.PORT || 3000

  fastify.listen({ port }, (error) => {
    if (error) {
      console.error(error)
      process.exit(1)
    }
    console.info(`
    *** Listening on Port: ${port} ***

    * Navigate to http://localhost:${port}/ and then check back here to see the exported OpenTelemetry spans. *
    `)
  })
}

start()
