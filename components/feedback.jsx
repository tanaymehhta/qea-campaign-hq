import { submitFeedback } from "../app/feedback/actions";
import { Chev } from "./ui";

/**
 * The box that sits at the foot of every page, folded shut.
 *
 * A <details> rather than a modal or a floating widget, for the same reason
 * every other disclosure here is one: it works with JavaScript off and there
 * is no open/closed state for anyone to manage. Which page it came from and
 * which rep was selected are read from the Referer on the POST, so the whole
 * form is one sentence and, if it helps, a picture.
 */
export default function FeedbackBox() {
  return (
    <details className="fb" id="feedback">
      <summary>
        Something wrong, missing, or worth building? <Chev />
      </summary>
      <div className="fbbody">
        <form action={submitFeedback} className="fbform">
          <textarea
            name="body"
            required
            rows={3}
            maxLength={5000}
            placeholder="What did you expect to see, and what did you see instead? Or what would make this page more useful?"
          />
          <div className="fbrow">
            <label className="fbfile">
              <span>Screenshot (optional)</span>
              <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp,image/gif" />
            </label>
            <button className="choice" type="submit">Send</button>
          </div>
          <p className="note" style={{ margin: 0 }}>
            The page you&rsquo;re on is attached automatically. Everything sent lands on{" "}
            <a href="/feedback">Feedback</a>.
          </p>
        </form>
      </div>
    </details>
  );
}
