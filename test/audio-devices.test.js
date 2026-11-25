import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDevice, deviceLabel } from "../shared/audioPick.js";

const plugged = [
  { id: "a1", label: "Speakers (Realtek(R) Audio)" },
  { id: "b2", label: "Headphones (WH-1000XM4)" },
];

test("no choice means the computer's default", () => {
  assert.deepEqual(pickDevice(null, plugged), { id: "", missing: false });
  assert.deepEqual(pickDevice({ id: "", label: "" }, plugged), { id: "", missing: false });
});

test("a chosen device is found by its id", () => {
  assert.deepEqual(pickDevice({ id: "b2", label: "Headphones (WH-1000XM4)" }, plugged), { id: "b2", missing: false });
});

test("a chosen device whose id changed is found again by its name", () => {
  assert.deepEqual(pickDevice({ id: "old", label: "Headphones (WH-1000XM4)" }, plugged), { id: "b2", missing: false });
  // the USB id on the end of a name doesn't matter
  assert.deepEqual(pickDevice({ id: "old", label: "USB Mic (0d8c:0014)" }, [{ id: "z", label: "USB Mic" }]), { id: "z", missing: false });
});

test("an unplugged device: use the default and say it's missing; it comes back when plugged in again", () => {
  const saved = { id: "b2", label: "Headphones (WH-1000XM4)" };
  assert.deepEqual(pickDevice(saved, [plugged[0]]), { id: "", missing: true });
  assert.deepEqual(pickDevice(saved, plugged), { id: "b2", missing: false });
});

test("two devices with the same name are ambiguous: not picked by name", () => {
  const twins = [{ id: "x", label: "USB Audio" }, { id: "y", label: "USB Audio" }];
  assert.deepEqual(pickDevice({ id: "gone", label: "USB Audio" }, twins), { id: "", missing: true });
});

test("deviceLabel: readable names, numbered placeholders before the browser shows names", () => {
  assert.equal(deviceLabel("Microphone (Yeti Stereo) (046d:0ab7)", "audioinput"), "Microphone (Yeti Stereo)");
  assert.equal(deviceLabel("", "audioinput", 1), "Microphone 2");
  assert.equal(deviceLabel("", "audiooutput", 0), "Speaker 1");
});
