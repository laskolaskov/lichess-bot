//load .env config
require('dotenv').config()
//emmiter - native
const {
    EventEmitter
} = require('events')
//requester
const fetch = require('node-fetch')
//loggers configuration
const SimpleNodeLogger = require('simple-node-logger')
const logOpts = {
    logFilePath: 'lichess-bot.log',
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
}
const engineLogOpts = {
    logFilePath: 'engine.log',
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
}
const log = SimpleNodeLogger.createSimpleFileLogger(logOpts)
const engineLog = SimpleNodeLogger.createSimpleFileLogger(engineLogOpts)
//chess library
const { Chess } = require('chess.js')
//chess engine - stockfish
const stockfishConstructor = require('stockfish')

//configurations
//environment config
const {
    BOT_TOKEN: token,
    BOT_ID: botID,
    URL: url
} = process.env

//chess engine config
const depth = 15

//games
const games = new Map()
//max games allowed
const maxGames = 100

//the chess library instance
const chess = new Chess()

async function processEvent(e) {
    log.info(`Processing event: ${e.type}`)
    log.info(e)
    switch (e.type) {
        case 'challenge':
            processChallenge(e)
            return
        case 'challengeCanceled':
            log.info(`Challenge by ${e.challenge.challenger.name} was canceled.`)
            return
        case 'challengeDeclined':
            log.info(`Challenge to ${e.challenge.challenger.name} was declined.`)
            return
        case 'gameStart':
            //create and add game object to games map
            const gameID = e.game.id
            const stockfish = makeStockfish(gameID)
            log.info(`Starting game '${gameID}'.`)
            games.set(gameID, {
                id: gameID,
                stockfish
            })
            gameState(gameID)
            return
        case 'gameFinish':
            //TODO - rermove game obj to the map
            if (games.has(e.game.id)) {
                log.info(`Ended game (${e.game.id}).`)
                games.delete(e.game.id)
            }
            return
        default:
            log.info(`Unknown event '${e.type}'.`)
            return
    }
}

async function processGameState(e, id) {
    log.info(`Game: ${id}. Processing game event: ${e.type}`)
    log.info(e)
    let gameObj
    let moves = []
    let movesMod = null
    switch (e.type) {
        case 'gameFull':
            //get game object
            gameObj = games.get(id)
            //determine who is white
            let isWhite = (e.white.id === botID)
            //add to game object
            gameObj.isWhite = isWhite
            let { stockfish } = gameObj 
            console.log(`Game: ${id}. Stockfish is playing with ${isWhite ? 'white' : 'black'}.`)
            //determine who moves and make a move
            if (e.initialFen === 'startpos') {
                if (isWhite) {
                    thinkerMove(stockfish)
                }
            } else {
                moves = e.state.moves.toString().trim().split(' ')
                movesMod = moves.length % 2
                log.info(`mod :: ${movesMod} | isWhite :: ${isWhite}`)
                if ((isWhite && movesMod === 0) || (!isWhite && movesMod === 1)) {
                    thinkerMove(stockfish, moves)
                }
            }
            //set game object
            games.set(id, gameObj)
            return
        case 'gameState':
            //handle non 'started' game states
            if (e.status !== 'started') {
                handleStatus(e)
                return
            }
            //get game object
            gameObj = games.get(id)
            //determine who moves and make a move
            moves = e.moves.toString().trim().split(' ')
            movesMod = moves.length % 2
            log.info(`mod :: ${movesMod} | isWhite :: ${gameObj.isWhite}`)
            if ((gameObj.isWhite && movesMod === 0) || (!gameObj.isWhite && movesMod === 1)) {
                thinkerMove(gameObj.stockfish, moves)
            }
            return
        case 'chatLine':
            //log.info(`Challenge to ${e.challenge.challenger.name} was declined.`)
            return
        default:
            log.info(`Unknown event '${e.type}'.`)
            return
    }
}

async function processChallenge(e) {
    if (games.size > maxGames) {
        log.info(`Maximum games (${maxGames}) reached. Auto declining challenge (${e.challenge.id}) by ${e.challenge.challenger.name}.`)
        declineChallenge(e.challenge.id)
        return
    }

    console.log(`Accepting challenge from ${e.challenge.challenger.name}`)
    //accept challenge
    acceptChallenge(e.challenge.id)
}

//ask Stockfish for move
function thinkerMove(stockfish, moves = []) {
    try {
        //reset board
        chess.reset()
        //play all moves
        moves.forEach(move => {
            //skip empty move
            if (!move) {
                return
            }
            chess.move(move, { sloppy: true }) || (() => {
                throw new Error(`Illegal move: '${move}'.FEN: '${chess.fen()}'.`)
            })()
        })
        //get FEN of the position
        const fen = chess.fen()
        //get PGN of the possition
        const pgn = chess.pgn()
        //console messages
        if (pgn) {
            console.log(`Opponent played. Moves so far:`)
            console.log(`${chess.pgn()}`)
        }
        console.log('Stockfish is on the move!')
        //engine logs
        //engineLog.info(`Game ID: ${currentGame}`) - TODO - fix ???
        engineLog.info(`Thinkering move in depth: ${depth}`)
        engineLog.info(`Position FEN: '${fen}'`)
        //ask Stockfish for the next move using the current FEN
        stockfish.postMessage(`position fen ${fen}`)
        stockfish.postMessage(`go depth ${depth}`)
        console.log('Stockfish is thinking...')
    } catch (error) {
        log.error(error)
        console.log('Encountered fatal error, check the log for details.')
        return
    }
}

function makeStockfish(id) {
    const stockfish = stockfishConstructor()
    stockfish.onmessage = function (event) {
        engineLog.info({
            id,
            event
        })
        const parsed = event.split(' ')
        if (parsed[0] === 'bestmove') {
            const move = parsed[1]
            console.log(`Stockfish played '${move}'.`)
            makeMove(id, move)
        }
    }    
    return stockfish
}

function handleStatus(event) {
    //statuses to handle: aborted | resign | mate
    if (event.status === 'resign') {
        console.log(`Opponent resigned !`)
    }
    if (event.status === 'aborted') {
        console.log(`Opponent aborted the game !`)
    }
    if (event.status === 'mate') {
        console.log(`Game ended in mate !`)
        /* if ((isWhite && e.winner === 'white') || (!isWhite && e.winner === 'black')) {
            console.log(`Stockfish won!`)
        } else {
            console.log(`Opponent won!`)
        } */
    }
    return
}

//make the request for a move
async function makeMove(gameID, move) {
    try {
        //make move request
        const moveUrl = `${url}/api/bot/game/${gameID}/move/${move}`
        const result = await fetchUrl(moveUrl, 'POST')
        result ? log.info(`Move '${move}' was made.`) : log.error(`Error while making move '${move}'.`)
    } catch (error) {
        log.error(error)
    }
}

//connect the game state stream listener
function gameState(id) {
    const gameStateStreamUrl = `${url}/api/bot/game/stream/${id}`
    const gameStateEmmiter = streamUrl(gameStateStreamUrl)
    gameStateEmmiter.on('data', (e) => {
        processGameState(e, id)
    })
}

async function acceptChallenge(id) {
    const acceptUrl = `https://lichess.org/api/challenge/${id}/accept`
    log.info(`Accepting challenge '${id}'.`)
    const result = await fetchUrl(acceptUrl, 'POST')
    result ? log.info(`Challenge '${id}' accepted.`) : log.error(`Error while accepting challenge '${id}'.`)
}

async function declineChallenge(id) {
    const declineUrl = `https://lichess.org/api/challenge/${id}/decline`
    log.info(`Declining challenge ${id}.`)
    const result = await fetchUrl(declineUrl, 'POST')
    result ? log.info(`Challenge '${id}' declined.`) : log.error(`Error while declining challenge '${id}'.`)
}


//make a request to regular Lichess endpoint
//return true/false on success/failiure 
async function fetchUrl(url, method = 'GET') {

    let retry = 0
    const maxAttempts = 5

    while (true) {
        try {
            log.info(`Calling: ${url}`)
            const resp = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })
            if (!resp.ok) {
                const message = await resp.text()
                throw new Error(`${resp.status}: ${message}`)
            }
            log.info(`success`)
            return true
        } catch (error) {
            log.error(error)
            retry++
            if (retry >= maxAttempts) {
                log.warn(); (`Maximum attempts (${maxAttempts}) reached. Aborting.`)
                return false
            }
            log.warn(`Trying again! Attempt: ${retry + 1}.`)
        }
    }
}

//make request to Lichess streaming URL
//return EventEmmiter when connected
function streamUrl(url) {
    const emmiter = new EventEmitter();
    (async function () {

        let retry = 0
        const maxAttempts = 5

        while (true) {
            try {
                log.info(`Calling: ${url}`)
                const resp = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                })
                if (!resp.ok) {
                    const message = await resp.text()
                    throw new Error(`${resp.status}: ${message}`)
                }
                log.info('Connected!')
                resp.body.on('data', async (chunk) => {
                    const data = chunk.toString()
                    if (data.trim()) {
                        emmiter.emit('data', JSON.parse(data.trim()))
                    }
                })
                break
            } catch (error) {
                log.error(error)
                retry++
                if (retry >= maxAttempts) {
                    log.warn(`Maximum attempts (${maxAttempts}) reached. Aborting.`)
                    console.log('Could not connect. Exiting. See logs for details.')
                    process.exit()
                }
                log.warn(`Trying again! Attempt: ${retry + 1}.`)
            }
        }
    })()

    return emmiter
}

//start
(function () {
    const eventsStreamUrl = `${url}/api/stream/event`

    const eventEmmiter = streamUrl(eventsStreamUrl)
    eventEmmiter.on('data', (e) => {
        processEvent(e)
    })
    console.log('Awaiting challenge!')
})()