import type { ReactNode } from 'react';

type Field = {
  type: ReactNode;
  description?: ReactNode;
  required?: boolean;
};

/** Static field reference: keep the explanation beside the name and type. */
export function TypeTable({ type, lang = 'en' }: { type: Record<string, Field>; lang?: string }) {
  const labels = lang === 'zh'
    ? { field: '字段', type: '类型', description: '说明', optional: '可选' }
    : { field: 'Field', type: 'Type', description: 'Description', optional: 'Optional' };

  return (
    <div className="rd-type-table not-prose">
      <table>
        <thead>
          <tr>
            <th scope="col">{labels.field}</th>
            <th scope="col">{labels.type}</th>
            <th scope="col">{labels.description}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(type).map(([name, field]) => (
            <tr key={name}>
              <th scope="row">
                <code>{name}{field.required === false ? <abbr title={labels.optional}>?</abbr> : null}</code>
              </th>
              <td className="rd-field-type"><code>{field.type}</code></td>
              <td className="rd-field-description">{field.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
