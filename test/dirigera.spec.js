/* global describe, beforeEach, afterEach, it,  */
// eslint-disable-next-line no-unused-vars
const should = require('should')
const helper = require('node-red-node-test-helper')
const testNode = require('../dirigera.js')

helper.init(require.resolve('node-red'))

describe('dirigera Node', function () {
  beforeEach(function (done) {
    helper.startServer(done)
  })

  afterEach(function (done) {
    helper.unload()
    helper.stopServer(done)
  })

  it('should be loaded', function (done) {
    const flow = [{ id: 'n1', type: 'dirigera', name: 'dirigera-set-name' }]
    helper.load(testNode, flow, function () {
      const n1 = helper.getNode('n1')
      try {
        n1.should.have.property('name', 'dirigera-set-name')
        done()
      } catch (err) {
        done(err)
      }
    })
  })
  it('should throw error after input if empty config', function (done) {
    const flow = [{ id: 'n1', type: 'dirigera', name: 'dirigera-set-name' }]
    helper.load(testNode, flow, function () {
      const n1 = helper.getNode('n1')
      n1.on('call:error', function (msg) {
        try {
          msg.should.have.property('firstArg', 'Unknown config error')
          done()
        } catch (error) {
          console.error(`Error: ${error.message}`)
        }
      })
      n1.receive({ payload: '' })
    })
  })
})
