namespace VoiceAttackBinaryDecoder;

internal sealed class DecodeCommandOptions
{
    public string? VoiceAttackDirectory { get; private set; }

    public string? InputFile { get; private set; }

    public bool ReadStdin { get; private set; }

    public static DecodeCommandOptions Parse(IReadOnlyList<string> args)
    {
        var options = new DecodeCommandOptions();
        for (var index = 0; index < args.Count; index += 1)
        {
            var argument = args[index];
            if (string.Equals(argument, "--voiceattack-dir", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 >= args.Count)
                {
                    throw new InvalidOperationException("Missing value for --voiceattack-dir.");
                }
                options.VoiceAttackDirectory = args[index + 1];
                index += 1;
                continue;
            }
            if (string.Equals(argument, "--input-file", StringComparison.OrdinalIgnoreCase))
            {
                if (index + 1 >= args.Count)
                {
                    throw new InvalidOperationException("Missing value for --input-file.");
                }
                options.InputFile = args[index + 1];
                index += 1;
                continue;
            }
            if (string.Equals(argument, "--stdin", StringComparison.OrdinalIgnoreCase))
            {
                options.ReadStdin = true;
                continue;
            }

            throw new InvalidOperationException($"Unknown decode argument: {argument}");
        }

        if (!options.ReadStdin && string.IsNullOrWhiteSpace(options.InputFile))
        {
            throw new InvalidOperationException("Supply either --stdin or --input-file for decode.");
        }

        return options;
    }
}
