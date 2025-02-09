<script lang="ts">

    // Original Code
    import * as Y from 'yjs';
    import { WebrtcProvider } from 'y-webrtc';
    import { writable } from 'svelte/store';

    import Invite from '$lib/Invite.svelte';
    import PersonIcon from '$lib/PersonIcon.svelte';
    import { makeId, createUserMetadata, areExpressionsEqual } from '$lib/util/helper';
    import { SvelteComponentTyped } from "svelte";

    type UserMetadata = ReturnType<typeof createUserMetadata>;

    type ExpressionState = Desmos.ExpressionState;
    type Calculator = Desmos.Calculator;
    
    const POLL_HZ = 30;

    let calculator: Calculator;
    let divEle: HTMLDivElement;
    let grapherDivEle: HTMLDivElement;

    let localMeta = createUserMetadata();

    let inviteLink: string;

    let nameStore = writable<UserMetadata[]>([]);

    type RemoteMouse = {
        x: number, y: number, 
        in: boolean, userId: string, 
        color: string, highlight: string
    };

    let remoteMousePositions = writable<RemoteMouse[]>([]);
    let lastModifiedBy = writable<Record<string, string>>({});

    const start = () => {
        const ydoc = new Y.Doc();
        const urlSearchParams = new URLSearchParams(location.search);
        const roomId = urlSearchParams.has("id") ? urlSearchParams.get("id") : makeId(6);
        window.ydoc = ydoc; // Add this immediately after const ydoc = new Y.Doc();
        console.log('Connected to room:', roomId);

        inviteLink = `${window.location.toString().split("?")[0]}?id=${roomId}`;

        const provider = new WebrtcProvider(`desmos-${roomId}`, ydoc, {
            signaling: ['ws://localhost:4444']
        });

        provider.awareness.setLocalStateField("user", localMeta);

        provider.awareness.setLocalStateField("mouse-x", 0);
        provider.awareness.setLocalStateField("mouse-y", 0);
        provider.awareness.setLocalStateField("mouse-in", true);

        provider.connect();

        provider.awareness.on('change', () => {
            console.log('Awareness states changed:', Array.from(provider.awareness.getStates().values()));
        });

        provider.on('status', (status) => {
            console.log('WebRTC Status:', status);
        });


        provider.awareness.on('change', () => {
            const users = Array.from(provider.awareness.getStates().values()) as {
                user: UserMetadata,
                "mouse-x": number,
                "mouse-y": number,
                "mouse-in": boolean
            }[];

            nameStore.update(_ => users.map(u => u.user).slice(1) as UserMetadata[]);
            remoteMousePositions.update(_ => users.map(u => ({
                x: u["mouse-x"],
                y: u["mouse-y"],
                in: u["mouse-in"],
                userId: u["user"]["userId"],
                color: u["user"]["colorGroup"]["color"],
                highlight: u["user"]["colorGroup"]["light"]
            })));           
        });
        
        const yarr = ydoc.getArray<ExpressionState>("equations");
       
        yarr.observe(() => {
            let syncedExpressions = yarr.toArray();
            console.log('Yjs Array Updated:', syncedExpressions);
            calculator.setExpressions(syncedExpressions);
        });


        let pastExpressions: Desmos.ExpressionState[];
        setInterval(() => {
            const expressions = calculator.getExpressions();
            console.log('Current Desmos Expressions:', expressions);
            if (!areExpressionsEqual(expressions, pastExpressions)) {
                pastExpressions = expressions;
                ydoc.transact(() => {
                    console.log('Inserting into Yjs Array:', expressions);
                    yarr.delete(0, yarr.length);
                    yarr.insert(0, expressions);
                });
            }
        }, 1000);

        const userSelections = ydoc.getMap<number>("selections");
        const userSelectionNodes = new Map<string, HTMLElement>();

        userSelections.observe(_ => {
            // Grab all user states
            const statesIter = provider
                .awareness
                .getStates()
                .values() as IterableIterator<{ user: UserMetadata }>;

            // Transform into array
            for (let { user: meta } of statesIter) {
                // Skip the userId
                if (meta.userId == localMeta.userId) continue;

                let index = userSelections.get(meta.userId);

                if (index !== undefined && index >= 0) {

                    // Create widget if it doesn't exist
                    if (!userSelectionNodes.has(meta.userId)) {
                        const node = document.getElementById(`icon-${meta.userId}`)?.cloneNode(true) as HTMLElement;
                        userSelectionNodes.set(meta.userId, node);
                    }

                    let node = userSelectionNodes.get(meta.userId) as HTMLElement;

                    // Show widget
                    node.style.setProperty("display", "block");
                    
                    // Find box and add the node to the box
                    // NOTE: Calling appendChild when "node"
                    // is already a child simply removed
                    // "node" from it's original parents
                    // and adds it to the new parents.
                    let box = Array.from(
                        document.getElementsByClassName("dcg-expressionitem")
                    )[index];
                    
                    console.log(node);

                    box.appendChild(node);

                } else {
                    // Hide widget, if it exists
                    userSelectionNodes
                        .get(meta.userId)?.style
                        .setProperty("display", "none");
                }
            }
        });


        calculator = Desmos.GraphingCalculator(divEle, {
            autosize: true,
            images: false,
            folders: false,
            expressions: true,
            trace: true
        });

        setTimeout(() => {
            grapherDivEle = divEle.getElementsByClassName("dcg-grapher").item(0) as HTMLDivElement;
            grapherDivEle.addEventListener("mouseenter", () => {;
                provider.awareness.setLocalStateField("mouse-in", true);
            });
            grapherDivEle.addEventListener("mouseleave", () => {
                provider.awareness.setLocalStateField("mouse-in", false);
            });
            grapherDivEle.addEventListener("mousemove", event => {
                if (divEle == null) return;

                let clientBoundingRect = divEle.getBoundingClientRect();

                // Check if mouse is inside canvas
                let mathPos = calculator.pixelsToMath({
                    x: event.pageX - clientBoundingRect.left,
                    y: event.pageY - clientBoundingRect.top
                });

                provider.awareness.setLocalStateField("mouse-x", mathPos.x);
                provider.awareness.setLocalStateField("mouse-y", mathPos.y);
            });
        }, 100);
    };
    // New Code for Save, Load, and Delete Functionality
    let graphName = '';
    let savedGraphs: string[] = [];
    let selectedGraph = '';
    let isSaved = writable(true);

    async function saveGraph() {
        if (!graphName.trim()) {
            alert('Please enter a graph name.');
            return;
        }
        const state = calculator.getState();
        const response = await fetch('http://localhost:5555/api/graphs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: graphName, data: state }),
        });
        const result = await response.json();
        if (response.ok) {
            alert(result.message);
            isSaved.set(true);
            fetchSavedGraphs();
        } else {
            alert('Failed to save the graph.');
        }
    }

    async function loadGraph() {
        if (!selectedGraph) {
            alert('Please select a graph to load.');
            return;
        }

        const response = await fetch(`http://localhost:5555/api/graphs?name=${selectedGraph}`, {
            method: 'GET',
        });

        if (response.ok) {
            const graphs = await response.json();
            console.log('Graph data received:', graphs);

            const graph = graphs.find(g => g.name === selectedGraph);

            if (graph && graph.data) {
                calculator.setState(graph.data);
                isSaved.set(true);
            } else {
                alert('Invalid graph data received.');
            }
        } else {
            alert(`Failed to load the graph "${selectedGraph}".`);
        }
    }

    async function fetchSavedGraphs() {
        const response = await fetch('http://localhost:5555/api/graphs');
        if (response.ok) {
            savedGraphs = await response.json();
        } else {
            alert('Failed to fetch saved graphs.');
        }
    }

    async function deleteGraph() {
        if (!selectedGraph) {
            alert('Please select a graph to delete.');
            return;
        }
        if (!confirm(`Are you sure you want to delete "${selectedGraph}"?`)) return;

        const response = await fetch(`http://localhost:5555/api/graphs?name=${selectedGraph}`, {
            method: 'DELETE',
        });
        const result = await response.json();
        if (response.ok) {
            alert(result.message);
            fetchSavedGraphs();
        } else {
            alert('Failed to delete the graph.');
        }
    }

    // Fetch saved graphs when the component is initialized
    fetchSavedGraphs();



    let showMenu = writable(false); // State to track menu visibility
    let showMenuValue;
    showMenuValue = showMenu; // Reactive statement to get the value of showMenu

    const toggleMenu = () => {
        showMenu.update((visible) => !visible); // Toggle the visibility
        fetchSavedGraphs(); // Fetch saved graphs when the menu is opened
    };



    let sizeCache = new Map<string, number>();
    function mathToCSSTransform(coord: RemoteMouse) {
        if (!grapherDivEle) return "";
        let pix = calculator.mathToPixels(coord);
        let doff = divEle.getBoundingClientRect();
        let off = grapherDivEle.getBoundingClientRect();

        if (pix.x < off.left) pix.x = off.left;
        if (pix.y < 0) pix.y = 0;
        if (pix.x > off.right - 10) pix.x = off.right - 10;
        if (pix.y > off.top + off.height - 10) pix.y = off.top + off.height - 10;

        let x = pix.x;
        let y = pix.y + doff.top;

        if (!sizeCache.has(coord.userId)) sizeCache.set(coord.userId, 0);

        let s = sizeCache.get(coord.userId) as number;

        if (coord.in) {
            s += (100 - s) * 0.1;
            sizeCache.set(coord.userId, s);
        } else {
            s = 0;
            sizeCache.set(coord.userId, s);
        }

        return `translate(${x}px, ${y}px) scale(${s}%)`;
    }


</script>

<svelte:head>
    <script
        src="https://www.desmos.com/api/v1.8/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6"
        on:load={start}
    ></script>
</svelte:head>

<div
    class="overflow-hidden w-screen h-screen absolute grid grid-cols-1 grid-rows-[auto_1fr]"
>
    <!-- Top bar -->
    <div
        class="h-20 overflow-hidden row-span-1 p-0 bg-gray-800 flex place-items-center pl-2"
    >
        <a href="/" target="_blank">
            <img
                src="/icons8-desmos-200.png"
                class="h-20 m-0"
                alt="Desmos icon by Icons8"
            />
        </a>

        <!--
        <span 
            class="
                w-16 h-16 p-0 mr-2 ml-2 
                bg-center bg-no-repeat bg-cover 
                rounded-full border-4
            " 
            style:background-image="url({localMeta.imageUrl})"
            style:border-color="{localMeta.colorGroup.color}"
        />
        -->

        <PersonIcon color={localMeta.colorGroup.color} />
        <div class="w-[0.2rem] h-8 bg-white mr-2 ml-2 rounded-full" />
        {#each $nameStore as meta}
            <PersonIcon color={meta.colorGroup.color} />
        {/each}
        <Invite url={inviteLink} />
    </div>

    <!-- Graph Container -->
    <div class="row-span-1 w-full h-full" bind:this={divEle}></div>
</div>

<!-- Save, Load, and Delete Section -->
<div class="absolute top-4 right-4 z-20">
    <button
        on:click={toggleMenu}
        class="bg-blue-500 text-white p-3 rounded-full shadow-lg"
    >
        ⚙️
    </button>

    {#if $showMenu}
        <!-- Collapsible Menu -->
        <div class="mt-2 bg-white shadow-lg rounded-lg p-4 w-64">
            <input
                type="text"
                bind:value={graphName}
                placeholder="Enter graph name"
                class="border p-2 w-full rounded mb-2"
            />
            <button
                on:click={saveGraph}
                class="bg-green-500 text-white px-4 py-2 w-full rounded"
            >
                💾 Save
            </button>
            <div class="mt-4">
                <select
                    bind:value={selectedGraph}
                    class="border p-2 w-full rounded mb-2"
                >
                    <option value="" disabled>Select a saved graph</option>
                    {#each savedGraphs as graph}
                        <option value={graph.name}>{graph.name}</option>
                    {/each}
                </select>
                <button
                    on:click={loadGraph}
                    class="bg-blue-500 text-white px-4 py-2 w-full rounded mb-2"
                >
                    🔄 Load
                </button>
                <button
                    on:click={deleteGraph}
                    class="bg-red-500 text-white px-4 py-2 w-full rounded"
                >
                    🗑️ Delete
                </button>
            </div>
            <div class="mt-2">
                {#if isSaved}
                    <p class="text-green-600">✔ All changes saved.</p>
                {:else}
                    <p class="text-red-600">⚠ Unsaved changes.</p>
                {/if}
            </div>
        </div>
    {/if}
</div>

<!-- Last Modified Info -->
<div class="absolute bottom-4 right-4 bg-gray-200 p-2 rounded shadow-md">
    <h4>Last Modified:</h4>
    <ul>
        {#each Object.entries($lastModifiedBy) as [id, user]}
            <li>Expression {id}: {user}</li>
        {/each}
    </ul>
</div>

{#each $remoteMousePositions as pos}
    <svg
        class="absolute top-0 left-0 w-8 h-8 pointer-events-none"
        style:transform={mathToCSSTransform(pos)}
    >
        <polygon
            points="0,0 15,5 12,8 20,18 18,20 8,12 5,15"
            fill={pos.color}
            stroke="black"
            stroke-width="2px"
            opacity="0.7"
        />
    </svg>
{/each}

{#each $nameStore as meta}
    <div
        id="icon-{meta.userId}"
        class="
        hidden absolute right-7 top-1 pointer-events-none w-12 h-12 scale-75"
    >
        <PersonIcon
            color={meta.colorGroup.color}
            bgColor="rgb(55 65 81)"
            outlineColor="rgb(107 114 128)"
        />
    </div>
{/each}

<style>
    :global(.dcg-graph-outer) {
        cursor: default;
    }
    .absolute {
        z-index: 10;
    }

    .top-4 {
        top: 1rem;
    }

    .right-4 {
        right: 1rem;
    }

    .z-20 {
        z-index: 20;
    }

    .shadow-lg {
        box-shadow:
            0 4px 6px rgba(0, 0, 0, 0.1),
            0 1px 3px rgba(0, 0, 0, 0.06);
    }

    .rounded-full {
        border-radius: 9999px;
    }

    .rounded-lg {
        border-radius: 0.5rem;
    }
</style>
