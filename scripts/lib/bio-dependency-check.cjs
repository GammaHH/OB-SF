// All groups are required; one productive alternative satisfies each group.
function checkDependencies(dependencies, equipmentEdges = new Set()) {
    const resolved = new Set();
    let previous;
    do {
        previous = resolved.size;
        for (const [file, groups] of dependencies) {
            if (groups.every(group => group.some(target => resolved.has(target)))) resolved.add(file);
        }
    } while (resolved.size !== previous);
    function cycleFrom(start) {
        const edges = file => (dependencies.get(file) || [])
            .filter(group => !group.some(target => resolved.has(target))).flat();
        const active = new Map([[start, 0]]), finished = new Set();
        const frames = [{ file: start, edges: edges(start), next: 0 }];
        while (frames.length) {
            const frame = frames.at(-1);
            if (frame.next === frame.edges.length) {
                active.delete(frame.file); finished.add(frame.file); frames.pop(); continue;
            }
            const target = frame.edges[frame.next++];
            if (active.has(target)) {
                const cycle = frames.slice(active.get(target)).map(value => value.file).concat(target);
                const equipment = cycle.slice(1).some((file, index) =>
                    equipmentEdges.has(JSON.stringify([cycle[index], file])));
                return { cycle, equipment };
            }
            if (finished.has(target)) continue;
            active.set(target, frames.length);
            frames.push({ file: target, edges: edges(target), next: 0 });
        }
        return null;
    }
    return { resolved, cycleFrom };
}
module.exports = { checkDependencies };
