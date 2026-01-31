const CONTROLS = new Set([
    'Sequence', 'Fallback', 'Parallel', 'ReactiveSequence', 'ReactiveFallback',
    'SequenceStar', 'FallbackStar', 'IfThenElse', 'WhileDo', 'Switch2', 'Switch3', 'Switch4', 'Switch5', 'Switch6'
]);

const DECORATORS = new Set([
    'Inverter', 'ForceSuccess', 'ForceFailure', 'Repeat', 'RetryUntilSuccessful', 'KeepRunningUntilFailure',
    'Delay', 'TimeLimit', 'BlackboardCheckDecorator', 'SubTree', 'Root'
]);

function getNodeType(name, childCount) {
    if (CONTROLS.has(name)) return "Control";
    if (DECORATORS.has(name)) return "Decorator";
    if (name.endsWith("Action")) return "Action";
    if (name.endsWith("Condition")) return "Condition";

    if (childCount > 0) return "Control";
    return "Action";
}

function getIcon(name, type) {
    switch (name) {
        case "Sequence": return "→";
        case "Fallback": return "?";
        case "Parallel": return "⇉";
        case "ReactiveSequence": return "R→";
        case "ReactiveFallback": return "R?";
        case "Inverter": return "!";
        case "ForceSuccess": return "✓";
        case "ForceFailure": return "✕";
        case "SubTree": return "📁";
    }

    switch (type) {
        case "Control": return "❖";
        case "Decorator": return "◆";
        case "Condition": return "○";
        case "Action": return "⚡";
        default: return "";
    }
}

// Test Cases
const tests = [
    { name: "Sequence", children: 2, expectedType: "Control", expectedIcon: "→" },
    { name: "Fallback", children: 2, expectedType: "Control", expectedIcon: "?" },
    { name: "MyUnknownNode", children: 2, expectedType: "Control", expectedIcon: "❖" },
    { name: "MyAction", children: 0, expectedType: "Action", expectedIcon: "⚡" }, // Ends with Action
    { name: "CheckBatteryCondition", children: 0, expectedType: "Condition", expectedIcon: "○" }, // Ends with Condition
    { name: "MoveBase", children: 0, expectedType: "Action", expectedIcon: "⚡" }, // Default leaf
    { name: "Inverter", children: 1, expectedType: "Decorator", expectedIcon: "!" },
    { name: "RetryUntilSuccessful", children: 1, expectedType: "Decorator", expectedIcon: "◆" }, // Generic Decorator icon
    { name: "SubTree", children: 0, expectedType: "Decorator", expectedIcon: "📁" }, // SubTree is special
];

let failed = false;
tests.forEach(t => {
    const type = getNodeType(t.name, t.children);
    const icon = getIcon(t.name, type);

    if (type !== t.expectedType) {
        console.error(`FAIL: ${t.name} type mismatch. Got ${type}, expected ${t.expectedType}`);
        failed = true;
    }
    if (icon !== t.expectedIcon) {
        console.error(`FAIL: ${t.name} icon mismatch. Got ${icon}, expected ${t.expectedIcon}`);
        failed = true;
    }
});

if (!failed) {
    console.log("All tests passed!");
}
