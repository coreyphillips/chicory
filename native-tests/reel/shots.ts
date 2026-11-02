/**
 * The shots the reel plays (native-tests/Reel.tsx): Send from the hold to
 * its result and home, and Receive from a request waiting to its receipt,
 * each answered as a wallet on a phone answers, late. A shot's `hold` is how
 * long it stays once reached, long enough to see its motion through.
 */
import { durations } from '../../src/motion/tokens';
import { receiptOf } from '../../test-support/fixtures';
import { STEP_MS } from '../gallery/drive';
import {
  AMOUNT_4200,
  REVIEW,
  SEND,
  TO_REQUEST,
  answered,
  receive,
  send,
} from '../gallery/payments';
import type { Shot, Step } from '../gallery/shots';

/** How long after the ring is whole a finger's press is reported complete. */
const HOLD_MARGIN_MS = 60;

/**
 * How long after the hold commits the wallet answers: past the burst, with
 * the comet seen running a lap before the result grows out of the hold.
 */
const ANSWER_MS = 2000;

/** A finger coming down on the hold labelled `label`. */
const down =
  (label: string): Step =>
  drive =>
    drive.hold(label, 'down');

/**
 * The same finger, still down as the hold completes, then lifted. The step
 * runs STEP_MS after `down`, so it waits out the rest of the hold before it
 * reports the press complete, where the gesture handler would at 700ms.
 */
const held =
  (label: string): Step =>
  drive =>
    new Promise(resolve =>
      setTimeout(() => {
        drive.hold(label, 'complete');
        drive.hold(label, 'up');
        resolve();
      }, durations.hold + HOLD_MARGIN_MS - STEP_MS),
    );

/** The amount keyed in, reviewed, and held to send with a real hold. */
const HELD_TO_SEND = [...AMOUNT_4200, REVIEW, down(SEND), held(SEND)];

/** From the hold to the result and home: the hold, the flight and the landing. */
const SENT_MS = 7000;

/** From the hold to a failure, which stays until it is tapped. */
const FAILED_MS = 5000;

/** A request waiting through two polls, paid on the third, and its bloom. */
const PAID_MS = 8000;

export const REEL: Shot[] = [
  send(
    'hold, in flight, sent',
    () => ({
      client: { send: answered('completed', {}, ANSWER_MS) },
      steps: HELD_TO_SEND,
    }),
    SENT_MS,
  ),
  send(
    'hold, in flight, failed',
    () => ({
      client: {
        send: answered(
          'failed',
          { message: 'No route to the recipient.' },
          ANSWER_MS,
        ),
      },
      steps: HELD_TO_SEND,
    }),
    FAILED_MS,
  ),
  receive(
    'request, paid on the third poll',
    () => {
      let polls = 0;
      return {
        client: {
          getReceiveStatus: async () => {
            polls += 1;
            return receiptOf(polls > 2 ? 'completed' : 'waiting');
          },
        },
        steps: TO_REQUEST,
      };
    },
    PAID_MS,
  ),
];
