'use strict'

/**
 * Library for managing the blockchain
 * Blocks are individual ledger events written to the chain
 * Anchors are grouped block hashes
 * @author Nathaniel Thomas <nthomas20@gmail.com>
 * @module Blockchain/simplechain
 */

const ObjectHash = require('node-object-hash')
const sqlite = require('sqlite')

/**
 * Block consisting of a single transaction
 * @class
 * @memberof module:Blockchain/simplechain
 */
class Block {
  constructor (data, o = null) {
    if (o === null) {
      this.data = data
      this.timestamp = new Date() / 1
    } else {
      this.object = o
      this.index = o.index
      this.previousHash = o.previousHash
      this.nonce = o.nonce
    }
  }

  build (index, previousHash, nonce) {
    this.index = index
    this.previousHash = previousHash
    this.nonce = nonce

    this.object = {
      index: index,
      timestamp: this.timestamp,
      previousHash: previousHash,
      data: this.data,
      nonce: nonce
    }

    this.object['hash'] = this.hash()

    return this
  }

  hash () {
    let tmpObject = Object.assign({}, this.object)
    delete tmpObject.hash

    return new ObjectHash().hash(tmpObject)
  }

  isValid (previousBlock) {
    if (previousBlock.index + 1 !== this.index) {
      // Invalid index
      return false
    } else if (previousBlock.hash() !== this.previousHash) {
      // The previous hash is incorrect
      return false
    } else if (this.object.hash !== this.hash()) {
      // The hash isn't correct
      return false
    }

    return true
  }
}

/**
 * Chain that manages transaction blocks
 * @class
 * @memberof module:Blockchain/simplechain
 */
class Chain {
  constructor (name, powHashPrefix = 'dab') {
    this.name = name
    this.powHashPrefix = powHashPrefix
    this.maxRandomNonce = 876348467
  }

  async initialize (seed = true) {
    this._chain = await sqlite.open(`./${this.name}.db`, { Promise })
    this._anchor = await sqlite.open(`./${this.name}.anchor.db`, { Promise })

    // Iniitalize chain table
    await this._chain.run('CREATE TABLE IF NOT EXISTS chain (i INTEGER PRIMARY KEY ASC, hash VARCHAR, previousHash VARCHAR, nonce INTEGER, timestamp INTEGER, data VARCHAR)')
    await this._chain.run('CREATE UNIQUE INDEX IF NOT EXISTS index_hash ON chain (hash)')

    // Initialize anchor table
    await this._anchor.run('CREATE TABLE IF NOT EXISTS anchor (i INTEGER PRIMARY KEY ASC, hash VARCHAR, previousHash VARCHAR)')
    await this._anchor.run('CREATE UNIQUE INDEX IF NOT EXISTS index_hash ON anchor (hash)')

    if (seed === true) {
      let finalRow = await this._chain.all('SELECT * FROM chain ORDER BY i DESC LIMIT 1')

      if (finalRow.length === 0) {
        this.currentBlock = new Block('GENBLOCK').build(0, -1, 0)
        this.currentBlock.object.hash = this.currentBlock.hash()

        await this._addBlockToChain(this.currentBlock)
      } else {
        this.currentBlock = new Block(finalRow[0].data).build(finalRow[0].i, finalRow[0].previousHash, finalRow[0].nonce)
        this.currentBlock.timestamp = finalRow[0].timestamp
        this.currentBlock.object.timestamp = finalRow[0].timestamp
        this.currentBlock.object.hash = this.currentBlock.hash()
      }
    }

    return true
  }

  _proofOfWork (block) {
    if (this.powHashPrefix === null) {
      return block
    }

    // Do the work to validate the hash prefix
    while (true) {
      if (block.object.hash.slice(0, this.powHashPrefix.length) === this.powHashPrefix) {
        return block
      } else {
        // Increase the nonce and rebuild the block hash
        block.nonce++
        block.build(block.index, block.previousHash, block.nonce)
      }
    }
  }

  async _addBlockToChain (block) {
    try {
      await this._chain.run('INSERT INTO chain VALUES (?, ?, ?, ?, ?, ?)', [
        block.index,
        block.hash(),
        block.previousHash,
        block.nonce,
        block.timestamp,
        JSON.stringify(block.data)
      ])

      return true
    } catch (err) {
      return false
    }
  }

  async add (block) {
    let randomNonce = Math.floor(Math.random() * Math.floor(this.maxRandomNonce))

    block.build(this.currentBlock.index + 1, this.currentBlock.hash(), randomNonce)

    block = this._proofOfWork(block)

    if (block.isValid(this.currentBlock)) {
      if (await this._addBlockToChain(block) === true) {
        this.currentBlock = block

        return this.currentBlock.object.hash
      } else {
        return false
      }
    } else {
      return false
    }
  }

  async anchor () {
    // Get latest anchor
    let anchorRows = await this._anchor.all('SELECT i, hash FROM anchor ORDER BY i DESC LIMIT 1')
    let previousAnchor = 0
    let previoushash = -1

    if (anchorRows.length > 0) {
      previousAnchor = anchorRows[0]['i']
      previoushash = anchorRows[0]['hash']
    }

    // Grab hashes of all previous blocks
    let hashRows = await this._chain.all('SELECT hash FROM chain WHERE i > ? AND i <= ? ORDER BY i ASC', [
      previousAnchor, this.currentBlock.index
    ])

    if (hashRows.length > 0) {
      let anchorHash = new ObjectHash().hash(hashRows)

      try {
        await this._anchor.run('INSERT INTO anchor VALUES (?, ?, ?)', [
          this.currentBlock.index,
          anchorHash,
          previoushash
        ])
      } catch (err) {
        return false
      }

      return true
    }

    return false
  }

  get length () {
    return this.currentBlock.index + 1
  }
}

exports.Block = Block
exports.Chain = Chain
