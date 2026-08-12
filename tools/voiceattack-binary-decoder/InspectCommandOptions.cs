namespace VoiceAttackBinaryDecoder;

internal sealed class InspectCommandOptions
{
    public string? VoiceAttackDirectory { get; private set; }

    public static InspectCommandOptions Parse(IReadOnlyList<string> args)
    {
        var options = new InspectCommandOptions();
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

            throw new InvalidOperationException($"Unknown inspect argument: {argument}");
        }

        return options;
    }
}
