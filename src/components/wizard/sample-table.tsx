import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Props = { headers: string[]; rows: Record<string, string>[] };

/** First rows of the uploaded CSV, as parsed. */
export function SampleTable({ headers, rows }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background/40">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/70 hover:bg-muted/70">
            {headers.map((h) => (
              <TableHead key={h} className="text-xs text-muted-foreground">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {headers.map((h) => (
                <TableCell key={h} className="max-w-56 truncate">
                  {row[h]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
