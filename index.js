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
//readline
const readline = require('readline')
//chess library
const { Chess } = require('chess.js')
//chess engine - stockfish
const stockfish = require('stockfish')()
//configurations
//environment config
const {
    BOT_TOKEN: token,
    BOT_ID: botID,
    URL: url
} = process.env
//readline config
const rlOpts = {
    input: process.stdin,
    output: process.stdout
}
//chess engine config
const depth = 15

//the chess library instance
const chess = new Chess()

//globals
let currentGame = null
let isWhite = null

//TODO
//1. handle end game (aborted | resigned, etc.) - DONE
//2. play multiple games simultaneously.
//3. auto login on start

//handler for Stockfish events
stockfish.onmessage = function (event) {
    engineLog.info(`${event}`)
    const parsed = event.split(' ')
    if (parsed[0] === 'bestmove') {
        const move = parsed[1]
        console.log(`Stockfish played '${move}'.`)
        makeMove(move)
    }
}

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
            log.info(`Starting game '${e.game.id}'.`)
            currentGame = e.game.id
            gameState(currentGame)
            return
        case 'gameFinish':
            if (e.game.id === currentGame) {
                log.info(`Ended current game (${currentGame}).`)
                currentGame = null
                console.log(`Game ended. Awaiting new challenge!`)
            }
            return
        default:
            log.info(`Unknown event '${e.type}'.`)
            return
    }
}

async function processGameState(e) {
    log.info(`Processing game event: ${e.type}`)
    log.info(e)
    let moves = []
    let movesMod = null
    switch (e.type) {
        case 'gameFull':
            //determine who is white
            isWhite = (e.white.id === botID)
            //determine who moves and make a move
            if (e.initialFen === 'startpos') {
                if (isWhite) {
                    thinkerMove()
                }
            } else {
                moves = e.state.moves.toString().trim().split(' ')
                movesMod = moves.length % 2
                log.info(`mod :: ${movesMod} | isWhite :: ${isWhite}`)
                if ((isWhite && movesMod === 0) || (!isWhite && movesMod === 1)) {
                    thinkerMove(moves)
                }
            }
            return
        case 'gameState':
            //handle non 'started' game states
            if (e.status !== 'started') {
                handleStatus(e)
                return
            }
            //determine who moves and make a move
            moves = e.moves.toString().trim().split(' ')
            movesMod = moves.length % 2
            log.info(`mod :: ${movesMod} | isWhite :: ${isWhite}`)
            if ((isWhite && movesMod === 0) || (!isWhite && movesMod === 1)) {
                thinkerMove(moves)
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
    if (currentGame) {
        log.info(`Game ${currentGame} in progress. Auto declining challenge (${e.challenge.id}) by ${e.challenge.challenger.name}.`)
        declineChallenge(e.challenge.id)
        return
    }

    //set current game
    currentGame = e.challenge.id

    console.log(`Accepting challenge from ${e.challenge.challenger.name}`)
    //accept challenge
    acceptChallenge(e.challenge.id)
}

//ask Stockfish for move
function thinkerMove(moves = []) {
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
        engineLog.info(`Game ID: ${currentGame}`)
        engineLog.info(`Thinkering move in depth: ${depth}`)
        engineLog.info(`Position FEN: '${fen}'`)
        //ask Stockfish for the next move using the current FEN
        stockfish.postMessage(`position fen ${fen}`)
        stockfish.postMessage(`go depth ${depth}`)
        console.log('Stockfish is thinking...')
    } catch (error) {
        log.error(error)
        console.log('Exiting with fatal error, check the log for details.')
        return
    }
}

//make the request for a move
async function makeMove(move) {
    try {
        //make move request
        const moveUrl = `${url}/api/bot/game/${currentGame}/move/${move}`
        const result = await fetchUrl(moveUrl, 'POST')
        result ? log.info(`Move '${move}' was made.`) : log.error(`Error while making move '${move}'.`)
    } catch (error) {
        log.error(error)
        rl.prompt()
    }
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
        if ((isWhite && e.winner === 'white') || (!isWhite && e.winner === 'black')) {
            console.log(`Stockfish won!`)
        } else {
            console.log(`Opponent won!`)
        }
    }
    return
}

//connect the game state stream listener
function gameState(id) {
    const gameStateStreamUrl = `${url}/api/bot/game/stream/${id}`
    const gameStateEmmiter = streamUrl(gameStateStreamUrl)
    gameStateEmmiter.on('data', (e) => {
        processGameState(e)
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
    //clear if declining current challenge
    if (currentGame === id) {
        currentGame = null
    }
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