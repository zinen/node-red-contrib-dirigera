module.exports = function (RED) {
  'use strict'
  const { Authenticate, Dirigera } = require('dirigera-simple')
  const Path = require('path')
  const fs = require('node:fs/promises')
  function parseToList (devicesRaw) {
    const connectedDevices = {}
    for (const device of devicesRaw) {
      if (device.type === 'gateway') continue

      if (!Object.prototype.hasOwnProperty.call(connectedDevices, device.type)) {
        connectedDevices[device.type] = {}
      }
      if (!Object.prototype.hasOwnProperty.call(connectedDevices[device.type], device.room.name)) {
        connectedDevices[device.type][device.room.name] = {
          canReceive: device.capabilities.canReceive,
          list: [],
          id: device.room.id
        }
      }
      const newIndex = connectedDevices[device.type][device.room.name].list.push({
        id: device.id,
        name: device.attributes.customName,
        createdAt: device.createdAt,
        isReachable: device.isReachable
      })
      if (Object.prototype.hasOwnProperty.call(device.attributes, 'batteryPercentage')) {
        connectedDevices[device.type][device.room.name].list[newIndex - 1].batteryPercentage = device.attributes.batteryPercentage
      }
      if (Object.prototype.hasOwnProperty.call(device.attributes, 'blindsTargetLevel')) {
        connectedDevices[device.type][device.room.name].list[newIndex - 1].blindsTargetLevel = device.attributes.blindsTargetLevel
      }
    }
    return connectedDevices
  }
  // RED.httpAdmin.get('/ikeaDirigera/discover', RED.auth.needsPermission('dirigera.read'), async function (req, res) {
  //   console.log('starting /ikeaDirigera/discover', req.query)
  //   const disc = new Discover()
  //   disc.lookForDevice(data => {
  //     console.log(data)
  //     res.send(data)
  //     res.sendStatus(200)
  //   })
  //   res.setTimeout(4000, function () {
  //     if (store.temp2) {
  //       res.send(JSON.stringify(store.temp2))
  //     } else {
  //       console.log('Request has timed out.')
  //       res.sendStatus(408)
  //     }
  //   })
  // })
  RED.httpAdmin.get('/ikeaDirigera/auth', RED.auth.needsPermission('dirigera.read'), function (req, res) {
    console.log('/ikeaDirigera/auth > req.query', JSON.stringify(req.query))
    const onError = (errorText) => {
      if (done) return
      res.json(JSON.stringify({ error: errorText }))
      done = true
    }
    let done = false
    const hubAddress = String(req.query.hubAddress)
    if (!hubAddress) {
      onError('Hub address empty. Missing ip or hostname to use.')
      return
    }
    res.setTimeout(60000, function () {
      onError('Button push was not registered at adress: ' + hubAddress)
    })
    console.log('running auth against ip ' + hubAddress)
    try {
      /* eslint-disable no-new */
      new Authenticate(hubAddress, data => {
        console.log('x2', data)
        if (!data.error) {
          try {
            res.json(JSON.stringify(data))
            done = true
          } catch (error) {
            onError('/ikeaDirigera/auth > Authenticate callback:err> ' + String(error))
          }
        }
      })
    } catch (error) {
      console.log('sda')
      console.error(error)
      onError('/ikeaDirigera/auth > Authenticate new:err> ' + String(error))
    }
  })
  RED.httpAdmin.get('/ikeaDirigera/dirigera', RED.auth.needsPermission('dirigera.read'), function (req, res) {
    const node = RED.nodes.getNode(req.query.nodeId)
    if (node.dirigeraClient && node.dirigeraClient.state.loaded) {
      res.json(JSON.stringify(node.devices))
    } else {
      res.sendStatus(404)
    }
  })
  function DirigeraConfigNode (n) {
    RED.nodes.createNode(this, n)
    const node = this
    if (!node.credentials.hubAddress) return
    try {
      node.dirigeraClient = new Dirigera(
        node.credentials.hubAddress,
        node.credentials.hubAccessCode
      )
      node.dirigeraClient.getDeviceList(devices => {
        if (devices.error) {
          node.devices = null
          node.warn('Dirigera hub error: ' + String(devices.message))
          return
        }
        // console.log('getDeviceList > ' + JSON.stringify(devices))
        node.devices = parseToList(devices)
      })
      node.dirigeraClient.setDebug(true)
    } catch (error) {
      node.error('Dirigera config error: ' + error.message || error)
    }
    this.on('close', async function (removed, done) {
      // This node is being restarted or disabled/deleted
      try {
        if (removed) {
          // This node has been disabled/deleted
          if (node.nibeuplinkClient) node.nibeuplinkClient.clearSession()
          fs.unlink(Path.join(__dirname, '.session' + node.id + '.json')).catch()
        }
      } catch (_) { }
      done()
    })
  }
  RED.nodes.registerType('dirigera-config', DirigeraConfigNode, {
    credentials: {
      hubAddress: { type: 'text' },
      hubAccessCode: { type: 'text' }
    }
  })

  function DirigeraNode (config) {
    RED.nodes.createNode(this, config)
    const node = this
    this.config = config
    node.on('input', async function (msg, send, done) {
      node.server = RED.nodes.getNode(config.server)
      node.status({ fill: '', text: '' })
      try {
        if (!node.server || !node.server.dirigeraClient) {
          throw new Error('Unknown config error')
        }
        if (!(node.config.choiceType in node.server.devices)) {
          throw new Error(`Object does not have key: ${node.config.choiceType}`)
        }
        if (!(node.config.choiceRoom in node.server.devices[node.config.choiceType])) {
          throw new Error(`Object does not have key: ${node.config.choiceRoom}`)
        }
        if (msg.cmd) {
          msg.cmd = String(msg.cmd)
          if (!node.server.devices[node.config.choiceType][node.config.choiceRoom].canReceive.includes(msg.cmd)) {
            throw new Error(`${node.config.choiceType} does accept cmd: ${msg.cmd}, try: ${node.server.devices[node.config.choiceType][node.config.choiceRoom].canReceive.join(', ')}.`)
          }
          msg.payload = { [msg.cmd]: msg.payload }
          node.server.dirigeraClient.setRoomAttribute(node.server.devices[node.config.choiceType][node.config.choiceRoom].id, msg.payload)
          msg.id = node.server.devices[node.config.choiceType][node.config.choiceRoom].id
        } else {
          msg.payload = node.server.devices[node.config.choiceType][node.config.choiceRoom].list
          msg.cmd = node.server.devices[node.config.choiceType][node.config.choiceRoom].canReceive
        }
        // node.server.dirigeraClient.getDeviceList(async devices => {
        //   msg.payload = parseToList(devices)
        send(msg)
        done()
        // })
      } catch (error) {
        node.status({ fill: 'red', text: error.message || error })
        done(error.message || error)
      }
    })
  }
  RED.nodes.registerType('dirigera', DirigeraNode)
}
