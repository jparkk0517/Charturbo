import { Charturbo, type GraphLinkInput, type GraphNodeInput } from 'charturbo';

export const meta = {
  title: '2D force graph',
  description:
    'renderGraph with layout: force settles the network in the plane (the Barnes-Hut simulator of the 3D graph). Categories color the nodes and fill the legend: click hides one, hover fades the rest. Hover a node to highlight its links; arrow keys walk the nodes.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Five teams: a lead linked to every member, members in a ring, a few cross-team links
  const teams = ['Platform', 'Data', 'Web', 'Mobile', 'Design'];
  const nodes: GraphNodeInput[] = [];
  const links: GraphLinkInput[] = [];
  teams.forEach((team, t) => {
    const lead = nodes.length;
    nodes.push({ id: `${team}-lead`, name: `${team} lead`, category: team, value: 9 });
    for (let m = 0; m < 6; m++) {
      nodes.push({ id: `${team}-${m}`, name: `${team} ${m + 1}`, category: team, value: 2 + ((t * 7 + m * 3) % 5) });
      links.push({ source: `${team}-lead`, target: `${team}-${m}` });
      links.push({ source: `${team}-${m}`, target: `${team}-${(m + 1) % 6}` });
    }
    links.push({ source: lead, target: `${teams[(t + 1) % teams.length]}-lead`, lineWidth: 2.5 });
  });
  links.push({ source: 'Data-2', target: 'Web-4' }, { source: 'Mobile-1', target: 'Design-3' }, { source: 'Platform-5', target: 'Mobile-0' });

  sdk.renderGraph(
    { nodes, links, categories: teams },
    { title: 'Team collaboration', layout: 'force', symbolSize: [8, 22], force: { repulsion: 60, edgeLength: 30 }, labels: true }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
